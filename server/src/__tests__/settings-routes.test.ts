import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-settings-routes.db");

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  try {
    fs.unlinkSync(TEST_DB_PATH);
    fs.unlinkSync(TEST_DB_PATH + "-wal");
    fs.unlinkSync(TEST_DB_PATH + "-shm");
  } catch {}
});

describe("PUT /api/settings/timezone", () => {
  it("stores timezone and returns ok", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/timezone",
      payload: { timezone: "America/Chicago" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("rejects invalid timezone", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/timezone",
      payload: { timezone: "Not/ATimezone" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/settings/writing-prompt", () => {
  it("returns the seeded default prompt", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/writing-prompt", headers: { "x-persona-id": "1" } });
    expect(res.statusCode).toBe(200);
    // Migration 008 seeds a default writing prompt
    expect(res.json().text).toBeTruthy();
  });
});

describe("PUT /api/settings/writing-prompt", () => {
  it("saves a writing prompt and returns ok", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/writing-prompt",
      headers: { "x-persona-id": "1" },
      payload: { text: "Always start with a hook", source: "manual_edit" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("retrieves the saved prompt", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/writing-prompt", headers: { "x-persona-id": "1" } });
    expect(res.json().text).toBe("Always start with a hook");
  });
});

describe("GET /api/settings/writing-prompt/history", () => {
  it("returns history entries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings/writing-prompt/history",
      headers: { "x-persona-id": "1" },
    });
    expect(res.statusCode).toBe(200);
    const history = res.json().history;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].source).toBe("manual_edit");
  });
});

describe("Perplexity API key configuration", () => {
  it("GET exposes metadata and configuration state without exposing the stored value", async () => {
    const previous = process.env.PERPLEXITY_API_KEY;
    process.env.PERPLEXITY_API_KEY = "pplx-not-visible";
    try {
      const res = await app.inject({ method: "GET", url: "/api/config/keys" });

      expect(res.statusCode).toBe(200);
      const key = res.json().keys.find((entry: any) => entry.key === "PERPLEXITY_API_KEY");
      expect(key).toEqual({
        key: "PERPLEXITY_API_KEY",
        label: "Perplexity API Key",
        required: false,
        configured: true,
        prefix: "pplx-",
        url: "https://www.perplexity.ai/settings/api",
      });
      expect(JSON.stringify(key)).not.toContain("pplx-not-visible");
    } finally {
      if (previous === undefined) delete process.env.PERPLEXITY_API_KEY;
      else process.env.PERPLEXITY_API_KEY = previous;
    }
  });

  it("PUT accepts the key through the existing environment-file writer", async () => {
    const envPath = path.join(import.meta.dirname, "../../.env");
    const misplacedEnvPath = path.join(import.meta.dirname, "../.env");
    const previousFile = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : null;
    const previousMisplacedFile = fs.existsSync(misplacedEnvPath)
      ? fs.readFileSync(misplacedEnvPath, "utf-8")
      : null;
    const previousEnv = process.env.PERPLEXITY_API_KEY;
    try {
      const res = await app.inject({
        method: "PUT",
        url: "/api/config/keys",
        payload: { keys: { PERPLEXITY_API_KEY: "  pplx-route-test  " } },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(fs.readFileSync(envPath, "utf-8")).toContain("PERPLEXITY_API_KEY=pplx-route-test");
      expect(fs.existsSync(misplacedEnvPath) ? fs.readFileSync(misplacedEnvPath, "utf-8") : null)
        .toBe(previousMisplacedFile);
      expect(process.env.PERPLEXITY_API_KEY).toBe("pplx-route-test");
    } finally {
      if (previousFile === null) {
        try { fs.unlinkSync(envPath); } catch {}
      } else {
        fs.writeFileSync(envPath, previousFile, "utf-8");
      }
      if (previousMisplacedFile === null) {
        try { fs.unlinkSync(misplacedEnvPath); } catch {}
      } else {
        fs.writeFileSync(misplacedEnvPath, previousMisplacedFile, "utf-8");
      }
      if (previousEnv === undefined) delete process.env.PERPLEXITY_API_KEY;
      else process.env.PERPLEXITY_API_KEY = previousEnv;
    }
  });

  it.each([
    ["POST", "newline", "pplx-valid\nINJECTED_KEY=owned"],
    ["PUT", "carriage return", "pplx-valid\rINJECTED_KEY=owned"],
    ["PUT", "NUL", "pplx-valid\0INJECTED_KEY=owned"],
  ] as const)("%s rejects a %s-bearing key before changing the environment file", async (method, _label, value) => {
    const envPath = path.join(import.meta.dirname, "../../.env");
    const previousFile = fs.existsSync(envPath) ? fs.readFileSync(envPath) : null;
    const previousEnv = process.env.PERPLEXITY_API_KEY;
    try {
      const res = await app.inject({
        method,
        url: "/api/config/keys",
        payload: { keys: { PERPLEXITY_API_KEY: value } },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid value for PERPLEXITY_API_KEY" });
      expect(fs.existsSync(envPath) ? fs.readFileSync(envPath) : null).toEqual(previousFile);
      expect(process.env.PERPLEXITY_API_KEY).toBe(previousEnv);
    } finally {
      if (previousFile === null) {
        try { fs.unlinkSync(envPath); } catch {}
      } else {
        fs.writeFileSync(envPath, previousFile);
      }
      if (previousEnv === undefined) delete process.env.PERPLEXITY_API_KEY;
      else process.env.PERPLEXITY_API_KEY = previousEnv;
    }
  });
});

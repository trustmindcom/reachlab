import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

const TEST_DB_PATH = path.join(
  import.meta.dirname,
  "../../data/test-personas-routes.db"
);

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

describe("GET /api/personas", () => {
  it("lists personas and includes the default persona", async () => {
    const res = await app.inject({ method: "GET", url: "/api/personas" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.personas)).toBe(true);
    expect(body.personas.length).toBeGreaterThanOrEqual(1);
    expect(body.personas[0]).toHaveProperty("id");
    expect(body.personas[0]).toHaveProperty("name");
    expect(body.personas[0]).toHaveProperty("type");
  });
});

describe("GET /api/personas/:personaId", () => {
  it("returns the persona by id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/personas/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(1);
  });

  it("404s for a nonexistent persona", async () => {
    const res = await app.inject({ method: "GET", url: "/api/personas/99999" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/not found/i);
  });
});

describe("POST /api/personas", () => {
  it("creates a new persona with type=personal by default", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: { name: "Nate", linkedin_url: "https://www.linkedin.com/in/nate/" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Nate");
    expect(body.type).toBe("personal");
    expect(body.id).toBeGreaterThan(0);
  });

  it("infers type=company_page from a /company/ URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: {
        name: "Acme",
        linkedin_url: "https://www.linkedin.com/company/acme/",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe("company_page");
  });

  it("honors an explicit type override even for personal URLs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: {
        name: "X",
        linkedin_url: "https://www.linkedin.com/in/x/",
        type: "company_page",
      },
    });
    // The route respects the override when URL isn't /company/
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe("company_page");
  });

  it("company URL overrides an explicit type=personal (URL wins)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: {
        name: "Y",
        linkedin_url: "https://www.linkedin.com/company/y/",
        type: "personal",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe("company_page");
  });

  it("rejects empty name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: { name: "", linkedin_url: "https://www.linkedin.com/in/empty/" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing linkedin_url", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: { name: "no-url" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("new persona appears in subsequent list and can be fetched individually", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: { name: "Listable", linkedin_url: "https://www.linkedin.com/in/listable/" },
    });
    const newId = created.json().id;

    const list = await app.inject({ method: "GET", url: "/api/personas" });
    expect(list.statusCode).toBe(200);
    const ids = list.json().personas.map((p: { id: number }) => p.id);
    expect(ids).toContain(newId);

    const get = await app.inject({ method: "GET", url: `/api/personas/${newId}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().name).toBe("Listable");
  });
});

describe("PUT /api/personas/:personaId", () => {
  it("updates name only", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: { name: "Original", linkedin_url: "https://www.linkedin.com/in/orig/" },
    });
    const id = created.json().id;

    const res = await app.inject({
      method: "PUT",
      url: `/api/personas/${id}`,
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const after = await app.inject({ method: "GET", url: `/api/personas/${id}` });
    expect(after.json().name).toBe("Renamed");
    // linkedin_url unchanged
    expect(after.json().linkedin_url).toBe("https://www.linkedin.com/in/orig/");
  });

  it("updates linkedin_url only", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: { name: "URL-test", linkedin_url: "https://www.linkedin.com/in/a/" },
    });
    const id = created.json().id;

    await app.inject({
      method: "PUT",
      url: `/api/personas/${id}`,
      payload: { linkedin_url: "https://www.linkedin.com/in/b/" },
    });
    const after = await app.inject({ method: "GET", url: `/api/personas/${id}` });
    expect(after.json().linkedin_url).toBe("https://www.linkedin.com/in/b/");
    expect(after.json().name).toBe("URL-test");
  });

  it("404s for a nonexistent persona", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/personas/99999",
      payload: { name: "ghost" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects empty update name", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/personas/1",
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});

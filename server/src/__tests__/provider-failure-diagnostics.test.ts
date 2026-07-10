import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const diagnostics = vi.hoisted(() => ({
  client: null as any,
  clientError: null as Error | null,
  failStream: null as unknown as (request: any) => boolean,
  failCreate: false,
  failureDelayMs: 10,
  successDelayMs: 0,
  failedStreamInputs: [] as Array<{ system: unknown; messages: unknown[] }>,
  agentInputs: [] as Array<{ system: unknown; messages: unknown[] }>,
}));

vi.mock("../ai/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/client.js")>()),
  getClient: vi.fn(() => {
    if (diagnostics.clientError) throw diagnostics.clientError;
    return diagnostics.client;
  }),
}));

import { buildApp } from "../app.js";
import { initDatabase } from "../db/index.js";
import { startGeneration, updateGeneration } from "../db/generate-queries.js";

const TEST_DB_PATH = path.join(
  import.meta.dirname,
  "../../data/test-provider-failure-diagnostics.db",
);

const draft = {
  type: "operator" as const,
  hook: "Selected hook",
  body: "Selected body",
  closing: "Selected close",
  word_count: 6,
  structure_label: "Operator",
};

let app: FastifyInstance;

function removeTestDatabase(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix); } catch {}
  }
}

function cloneSystemAndMessages(request: any) {
  return JSON.parse(JSON.stringify({
    system: request.system,
    messages: request.messages,
  })) as { system: unknown; messages: unknown[] };
}

function mockStream(request: any) {
  const emitter = new EventEmitter() as any;
  emitter.abort = vi.fn(() => emitter.removeAllListeners());
  if (diagnostics.failStream(request)) {
    diagnostics.failedStreamInputs.push(cloneSystemAndMessages(request));
    setTimeout(
      () => emitter.emit("error", new Error("provider unavailable")),
      diagnostics.failureDelayMs,
    );
  } else {
    const responseText = JSON.stringify({
      hook: "Provider hook",
      body: "Provider body",
      closing: "Provider close",
      word_count: 6,
      structure_label: "Provider structure",
    });
    setTimeout(() => {
      emitter.emit("text", responseText, responseText);
      emitter.emit("finalMessage", {
        content: [{ type: "text", text: responseText }],
        usage: { input_tokens: 10, output_tokens: 20, thinking_tokens: 0 },
      });
      emitter.emit("end");
    }, diagnostics.successDelayMs);
  }
  return emitter;
}

beforeEach(async () => {
  removeTestDatabase();
  diagnostics.clientError = null;
  diagnostics.failStream = () => false;
  diagnostics.failCreate = false;
  diagnostics.failureDelayMs = 10;
  diagnostics.successDelayMs = 0;
  diagnostics.failedStreamInputs.length = 0;
  diagnostics.agentInputs.length = 0;
  diagnostics.client = {
    messages: {
      stream: vi.fn((request: any) => mockStream(request)),
      create: vi.fn(async (request: any) => {
        diagnostics.agentInputs.push(cloneSystemAndMessages(request));
        if (diagnostics.failCreate) throw new Error("provider unavailable");
        return {
          id: "msg_diagnostics",
          type: "message",
          role: "assistant",
          model: "mock",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Done.", citations: null }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }),
    },
  };
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  removeTestDatabase();
});

function runAndLogs(triggeredBy: string) {
  const db = initDatabase(TEST_DB_PATH);
  try {
    const run = db.prepare(
      `SELECT id, generation_id, status FROM ai_runs
       WHERE triggered_by = ? ORDER BY id DESC LIMIT 1`,
    ).get(triggeredBy) as { id: number; generation_id: number | null; status: string } | undefined;
    const logs = run
      ? db.prepare("SELECT * FROM ai_logs WHERE run_id = ? ORDER BY id").all(run.id) as any[]
      : [];
    return { run, logs };
  } finally {
    db.close();
  }
}

function startDraftGeneration(options?: {
  selection?: number[];
  rejected?: boolean;
  multiple?: boolean;
}) {
  const db = initDatabase(TEST_DB_PATH);
  try {
    const generationId = startGeneration(db, 1, "Exact provider failure intent");
    const drafts = options?.rejected
      ? [{
          type: "rejected_type_sentinel",
          hook: "rejected_hook_sentinel",
          body: "rejected_body_sentinel",
          closing: "rejected_closing_sentinel",
          word_count: 4,
          structure_label: "Rejected",
        }]
      : options?.multiple
        ? [draft, {
            type: "future",
            hook: "Second selected hook",
            body: "Second selected body",
            closing: "Second selected close",
            word_count: 7,
            structure_label: "Future",
          }]
        : [draft];
    updateGeneration(db, generationId, {
      drafts_json: JSON.stringify(drafts),
      selected_draft_indices: JSON.stringify(options?.selection ?? []),
    });
    return generationId;
  } finally {
    db.close();
  }
}

describe("client construction failure diagnostics", () => {
  const cases = [
    {
      label: "research",
      triggeredBy: "generate_research",
      prepare: () => {
        const db = initDatabase(TEST_DB_PATH);
        try {
          const generationId = startGeneration(db, 1, "Research client failure intent");
          return { generationId, url: "/api/generate/research?personaId=1", payload: { generation_id: generationId } };
        } finally { db.close(); }
      },
    },
    {
      label: "draft",
      triggeredBy: "generate_drafts",
      prepare: () => {
        const generationId = startDraftGeneration();
        return { generationId, url: "/api/generate/drafts?personaId=1", payload: { generation_id: generationId } };
      },
    },
    {
      label: "revision",
      triggeredBy: "revise_drafts",
      prepare: () => {
        const generationId = startDraftGeneration({ selection: [0] });
        return {
          generationId,
          url: "/api/generate/revise-drafts?personaId=1",
          payload: { generation_id: generationId, feedback: "Revise", mode: "revise_selected" },
        };
      },
    },
    {
      label: "ghostwriter",
      triggeredBy: "ghostwriter",
      prepare: () => {
        const generationId = startDraftGeneration();
        return {
          generationId,
          url: "/api/generate/ghostwrite?personaId=1",
          payload: { generation_id: generationId, message: "Write this" },
        };
      },
    },
  ];

  it.each(cases)("marks $label run failed with correlation and zero logs", async ({ triggeredBy, prepare }) => {
    const { generationId, url, payload } = prepare();
    diagnostics.clientError = new Error("client unavailable");

    const response = await app.inject({ method: "POST", url, payload });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "client unavailable" });
    expect(runAndLogs(triggeredBy)).toEqual({
      run: expect.objectContaining({ generation_id: generationId, status: "failed" }),
      logs: [],
    });
  });
});

function expectSingleFailedAttempt(
  triggeredBy: string,
  generationId: number,
  attemptedInput: { system: unknown; messages: unknown[] },
) {
  const { run, logs } = runAndLogs(triggeredBy);
  expect(run).toEqual(expect.objectContaining({ generation_id: generationId, status: "failed" }));
  const failedLogs = logs.filter((log) => log.output_text.includes("provider unavailable"));
  expect(failedLogs).toHaveLength(1);
  expect(JSON.parse(failedLogs[0].input_messages)).toEqual(attemptedInput);
  expect(failedLogs[0]).toEqual(expect.objectContaining({
    tool_calls: null,
    input_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
  }));
  expect(failedLogs[0].duration_ms).toBeGreaterThanOrEqual(0);
  return failedLogs[0];
}

describe("provider failure attempted-input diagnostics", () => {
  it("logs the failed initial draft provider call before failing the correlated run", async () => {
    const generationId = startDraftGeneration();
    diagnostics.failStream = (request) => String(request.messages[0].content).includes("CONTRARIAN");
    diagnostics.failureDelayMs = 0;
    diagnostics.successDelayMs = 25;

    const response = await app.inject({
      method: "POST", url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: generationId },
    });

    expect(response.statusCode).toBe(500);
    const log = expectSingleFailedAttempt(
      "generate_drafts", generationId, diagnostics.failedStreamInputs[0],
    );
    expect(log.step).toBe("draft_contrarian");
    expect(runAndLogs("generate_drafts").logs).toHaveLength(3);
  });

  it("logs the failed selected revision provider call before failing the correlated run", async () => {
    const generationId = startDraftGeneration({ selection: [0, 1], multiple: true });
    diagnostics.failStream = (request) =>
      String(request.messages[0].content).includes("Selected body");
    diagnostics.failureDelayMs = 0;
    diagnostics.successDelayMs = 25;

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=1",
      payload: { generation_id: generationId, feedback: "Exact feedback", mode: "revise_selected" },
    });

    expect(response.statusCode).toBe(500);
    const log = expectSingleFailedAttempt(
      "revise_drafts", generationId, diagnostics.failedStreamInputs[0],
    );
    expect(log.step).toBe("revise_operator");
    expect(runAndLogs("revise_drafts").logs).toHaveLength(2);
  });

  it("logs the failed restart provider call without rejected draft sentinels", async () => {
    const generationId = startDraftGeneration({ rejected: true });
    diagnostics.failStream = (request) => String(request.messages[0].content).includes("CONTRARIAN");
    diagnostics.failureDelayMs = 0;
    diagnostics.successDelayMs = 25;

    const response = await app.inject({
      method: "POST", url: "/api/generate/revise-drafts?personaId=1",
      payload: { generation_id: generationId, feedback: "Fresh feedback", mode: "restart_from_intent" },
    });

    expect(response.statusCode).toBe(500);
    const log = expectSingleFailedAttempt(
      "revise_drafts", generationId, diagnostics.failedStreamInputs[0],
    );
    expect(log.step).toBe("restart_contrarian");
    expect(log.input_messages).not.toContain("rejected_type_sentinel");
    expect(log.input_messages).not.toContain("rejected_hook_sentinel");
    expect(log.input_messages).not.toContain("rejected_body_sentinel");
    expect(log.input_messages).not.toContain("rejected_closing_sentinel");
    expect(runAndLogs("revise_drafts").logs).toHaveLength(3);
  });

  it("logs the failed ghostwriter iteration before failing the correlated run", async () => {
    const generationId = startDraftGeneration();
    diagnostics.failCreate = true;

    const response = await app.inject({
      method: "POST", url: "/api/generate/ghostwrite?personaId=1",
      payload: { generation_id: generationId, message: "Exact ghostwriter message" },
    });

    expect(response.statusCode).toBe(500);
    const log = expectSingleFailedAttempt(
      "ghostwriter", generationId, diagnostics.agentInputs[0],
    );
    expect(log.step).toBe("agent_turn");
  });
});

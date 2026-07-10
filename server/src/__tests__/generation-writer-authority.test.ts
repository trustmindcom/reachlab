import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const provider = vi.hoisted(() => ({
  streamInputs: [] as any[],
  agentInputs: [] as any[],
}));

function mockStream() {
  const responseText = JSON.stringify({
    hook: "Provider hook",
    body: "Provider body",
    closing: "Provider close",
    word_count: 6,
    structure_label: "Provider structure",
  });
  const emitter = new EventEmitter() as any;
  emitter.abort = vi.fn(() => emitter.removeAllListeners());
  setTimeout(() => {
    emitter.emit("text", responseText, responseText);
    emitter.emit("finalMessage", {
      content: [{ type: "text", text: responseText }],
      usage: { input_tokens: 10, output_tokens: 20, thinking_tokens: 0 },
    });
    emitter.emit("end");
  }, 0);
  return emitter;
}

const client = {
  messages: {
    stream: vi.fn((input: any) => {
      provider.streamInputs.push(input);
      return mockStream();
    }),
    create: vi.fn(async (input: any) => {
      provider.agentInputs.push(input);
      return {
        id: "msg_authority",
        type: "message",
        role: "assistant",
        model: "mock",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Intent retained.", citations: null }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    }),
  },
};

vi.mock("../ai/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/client.js")>()),
  getClient: vi.fn(() => client),
}));

import { buildApp } from "../app.js";
import { initDatabase } from "../db/index.js";
import { startGeneration, updateGeneration } from "../db/generate-queries.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-generation-writer-authority.db");
const drafts = [
  { type: "contrarian", hook: "Rejected hook", body: "UNSELECTED BODY", closing: "Rejected close", word_count: 6, structure_label: "Contrarian" },
  { type: "operator", hook: "Selected hook", body: "SELECTED BODY", closing: "Selected close", word_count: 6, structure_label: "Operator" },
];

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(TEST_DB_PATH);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix); } catch {}
  }
});

describe("intermediate-head writer authority gate", () => {
  it("puts each stored intent under the controlling heading in all three active provider inputs", async () => {
    provider.streamInputs.length = 0;
    provider.agentInputs.length = 0;
    const db = initDatabase(TEST_DB_PATH);
    const initialId = startGeneration(db, 1, "INITIAL stored intent?!");
    const revisionId = startGeneration(db, 1, "REVISION stored intent?!");
    updateGeneration(db, revisionId, {
      drafts_json: JSON.stringify(drafts),
      selected_draft_indices: JSON.stringify([1]),
    });
    const ghostwriterId = startGeneration(db, 1, "GHOSTWRITER stored intent?!");
    updateGeneration(db, ghostwriterId, {
      drafts_json: JSON.stringify(drafts),
      selected_draft_indices: JSON.stringify([1]),
    });
    db.close();

    const initialResponse = await app.inject({
      method: "POST",
      url: "/api/generate/drafts?personaId=1",
      payload: { generation_id: initialId, topic: "INITIAL replacement", angle: "INITIAL replacement angle" },
    });
    expect(initialResponse.statusCode, initialResponse.body).toBe(200);

    const revisionResponse = await app.inject({
      method: "POST",
      url: "/api/generate/revise-drafts?personaId=1",
      payload: { generation_id: revisionId, feedback: "Revise it", topic: "REVISION replacement", angle: "REVISION replacement angle" },
    });
    expect(revisionResponse.statusCode, revisionResponse.body).toBe(200);

    const ghostwriterResponse = await app.inject({
      method: "POST",
      url: "/api/generate/ghostwrite?personaId=1",
      payload: { generation_id: ghostwriterId, message: "Combine it", topic: "GHOSTWRITER replacement", angle: "GHOSTWRITER replacement angle" },
    });
    expect(ghostwriterResponse.statusCode, ghostwriterResponse.body).toBe(200);

    const initialProviderInputs = provider.streamInputs.slice(0, 3).map((input) => input.messages[0].content);
    const revisionProviderInput = provider.streamInputs[3].messages[0].content as string;
    const ghostwriterProviderInput = provider.agentInputs[0].system as string;

    for (const input of initialProviderInputs) {
      expect(input).toContain("## AUTHOR INTENT - CONTROLLING\n\nINITIAL stored intent?!");
      expect(input).not.toContain("INITIAL replacement");
    }
    expect(revisionProviderInput.startsWith("## AUTHOR INTENT - CONTROLLING\n\nREVISION stored intent?!")).toBe(true);
    expect(revisionProviderInput).toContain("SELECTED BODY");
    expect(revisionProviderInput).not.toContain("UNSELECTED BODY");
    expect(revisionProviderInput).not.toContain("REVISION replacement");
    expect(ghostwriterProviderInput.startsWith("## AUTHOR INTENT - CONTROLLING\n\nGHOSTWRITER stored intent?!")).toBe(true);
    expect(ghostwriterProviderInput).toContain("SELECTED BODY");
    expect(ghostwriterProviderInput).not.toContain("UNSELECTED BODY");
    expect(ghostwriterProviderInput).not.toContain("GHOSTWRITER replacement");
    expect(provider.agentInputs[0].tools.length).toBeGreaterThan(0);
  });

  it("preserves the legitimate empty-selection fallback to all current drafts", async () => {
    provider.agentInputs.length = 0;
    const db = initDatabase(TEST_DB_PATH);
    const generationId = startGeneration(db, 1, "Empty selection keeps all drafts available.");
    updateGeneration(db, generationId, {
      drafts_json: JSON.stringify(drafts),
      selected_draft_indices: JSON.stringify([]),
    });
    db.close();

    const response = await app.inject({
      method: "POST",
      url: "/api/generate/ghostwrite?personaId=1",
      payload: { generation_id: generationId, message: "Use the available drafts" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(provider.agentInputs[0].system).toContain("SELECTED BODY");
    expect(provider.agentInputs[0].system).toContain("UNSELECTED BODY");
  });
});

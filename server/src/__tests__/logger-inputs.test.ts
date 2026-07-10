import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Story } from "@reachlab/shared";
import { generateDrafts, restartDraftsFromIntent, reviseDrafts } from "../ai/drafter.js";
import { ghostwriterTurn } from "../ai/ghostwriter.js";
import { AiLogger } from "../ai/logger.js";
import { renderWritingContext, type WritingContext } from "../ai/writing-context.js";
import { createRun, getAiLogsForRun } from "../db/ai-queries.js";
import { initDatabase } from "../db/index.js";
import { textResponse, toolUseResponse } from "./helpers/mock-client.js";

const TEST_DB_PATH = path.join(import.meta.dirname, "../../data/test-logger-inputs.db");

const anchorEvidence: Story = {
  headline: "Exact anchor heading sentinel",
  summary: "Exact anchor evidence summary.",
  source: "Anchor Source",
  source_url: "https://example.com/anchor",
  age: "Today",
  tag: "operations",
  angles: ["Decision rights"],
  is_stretch: false,
};

const supportingEvidence: Story = {
  headline: "Exact supporting heading sentinel",
  summary: "Exact supporting evidence summary.",
  source: "Supporting Source",
  source_url: "https://example.com/supporting",
  age: "This week",
  tag: "governance",
  angles: ["Ownership"],
  is_stretch: false,
};

const context: WritingContext = {
  generationId: 71,
  authorIntent: "Exact stored intent sentinel",
  anchorEvidence,
  supportingEvidence: [supportingEvidence],
};

let db: ReturnType<typeof initDatabase>;

function removeTestDatabase(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix); } catch {}
  }
}

beforeEach(() => {
  removeTestDatabase();
  db = initDatabase(TEST_DB_PATH);
});

afterEach(() => {
  db.close();
  removeTestDatabase();
});

function makeLogger(triggeredBy: string): { logger: AiLogger; runId: number } {
  const runId = createRun(db, 1, triggeredBy, 0);
  return { logger: new AiLogger(db, runId), runId };
}

function makeMockStream(responseText: string) {
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

function makeStreamingClient() {
  const response = JSON.stringify({
    hook: "Hook", body: "Body", closing: "Close", word_count: 3, structure_label: "Test",
  });
  return {
    messages: { stream: vi.fn(() => makeMockStream(response)) },
  } as any;
}

type LoggedSystemAndMessages = { system: unknown; messages: unknown[] };

function loggedSystemAndMessagesByStep(runId: number): Record<string, LoggedSystemAndMessages> {
  return Object.fromEntries(
    getAiLogsForRun(db, runId).map((row) => [row.step, JSON.parse(row.input_messages)]),
  );
}

function systemAndMessagesFromCall(call: any[]): LoggedSystemAndMessages {
  return { system: call[0].system, messages: call[0].messages };
}

function streamingCallsByStep(client: any, prefix: "draft" | "restart") {
  return Object.fromEntries(client.messages.stream.mock.calls.map((call: any[]) => {
    const content = String(call[0].messages[0].content);
    const variation = content.includes("CONTRARIAN")
      ? "contrarian"
      : content.includes("OPERATOR")
        ? "operator"
        : "future";
    return [`${prefix}_${variation}`, systemAndMessagesFromCall(call)];
  }));
}

describe("writing logger provider system and messages", () => {
  it("stores each initial draft provider call's exact system and messages fields", async () => {
    const client = makeStreamingClient();
    const { logger, runId } = makeLogger("draft-logger-test");

    await generateDrafts(
      client, db, 1, logger, context,
      "Exact personal connection sentinel", "short",
    );

    const loggedInputs = loggedSystemAndMessagesByStep(runId);
    expect(loggedInputs).toEqual(streamingCallsByStep(client, "draft"));
    for (const input of Object.values(loggedInputs)) {
      const userInput = String((input.messages[0] as any).content);
      expect(userInput).toContain("Exact stored intent sentinel");
      expect(userInput).toContain("## ANCHOR EVIDENCE - FACTUAL CONTEXT ONLY");
      expect(userInput).toContain("Exact anchor heading sentinel");
      expect(userInput).toContain("## SUPPORTING EVIDENCE - MAY INFORM, MUST NOT REPLACE INTENT");
      expect(userInput).toContain("Exact supporting heading sentinel");
      expect(userInput).toContain("Exact personal connection sentinel");
      expect(userInput).toContain("## Length");
    }
  });

  it("stores the selected revision provider call's exact system and messages fields", async () => {
    const client = makeStreamingClient();
    const { logger, runId } = makeLogger("revision-logger-test");
    const selectedDraft = {
      type: "operator" as const,
      hook: "Selected hook sentinel",
      body: "Selected body sentinel",
      closing: "Selected close sentinel",
      word_count: 6,
      structure_label: "Operator",
    };

    await reviseDrafts(client, db, 1, logger, context, [selectedDraft], "Exact feedback sentinel", "medium");

    const loggedInput = loggedSystemAndMessagesByStep(runId).revise_operator;
    expect(loggedInput).toEqual(systemAndMessagesFromCall(client.messages.stream.mock.calls[0]));
    const userInput = String((loggedInput.messages[0] as any).content);
    expect(userInput).toContain("Exact stored intent sentinel");
    expect(userInput).toContain("Exact anchor heading sentinel");
    expect(userInput).toContain("Exact supporting heading sentinel");
    expect(userInput).toContain("Selected body sentinel");
    expect(userInput).toContain("Exact feedback sentinel");
  });

  it("stores each restart provider call's exact system and messages fields without rejected drafts", async () => {
    const client = makeStreamingClient();
    const { logger, runId } = makeLogger("restart-logger-test");

    await restartDraftsFromIntent(
      client, db, 1, logger, context,
      "Fresh variation feedback sentinel", "long",
    );

    const loggedInputs = loggedSystemAndMessagesByStep(runId);
    expect(loggedInputs).toEqual(streamingCallsByStep(client, "restart"));
    const variationLabels = {
      restart_contrarian: "CONTRARIAN",
      restart_operator: "OPERATOR",
      restart_future: "FUTURE-FACING",
    } as const;
    for (const [step, input] of Object.entries(loggedInputs)) {
      const providerInput = JSON.stringify(input);
      expect(providerInput).toContain("Exact stored intent sentinel");
      expect(providerInput).toContain("Exact anchor heading sentinel");
      expect(providerInput).toContain("Exact supporting heading sentinel");
      expect(providerInput).toContain("Fresh variation feedback sentinel");
      expect(providerInput).toContain(variationLabels[step as keyof typeof variationLabels]);
      expect(providerInput).not.toContain("rejected_hook_sentinel");
      expect(providerInput).not.toContain("rejected_body_sentinel");
      expect(providerInput).not.toContain("rejected_closing_sentinel");
    }
    expect(JSON.stringify(client.messages.stream.mock.calls)).not.toContain("rejected_body_sentinel");
  });

  it("stores each ghostwriter provider call's exact system and messages fields across tool iterations", async () => {
    const generationId = Number(db.prepare(
      `INSERT INTO generations (persona_id, post_type, status, author_intent)
       VALUES (1, 'general', 'draft', ?)`,
    ).run(context.authorIntent).lastInsertRowid);
    const responses = [
      toolUseResponse([{
        id: "tool_1",
        name: "get_platform_knowledge",
        input: { aspect: "hooks" },
      }]),
      textResponse("Ghostwriter complete."),
    ];
    const providerInputs: Array<{ system: unknown; messages: unknown[] }> = [];
    const create = vi.fn(async (request: any) => {
      providerInputs.push(JSON.parse(JSON.stringify({
        system: request.system,
        messages: request.messages,
      })));
      return responses.shift() as Anthropic.Messages.Message;
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const { logger, runId } = makeLogger("ghostwriter-logger-test");
    const systemPrompt = `${renderWritingContext(context)}\n\nExact ghostwriter behavior sentinel`;
    const initialMessages = [{ role: "user" as const, content: "Exact user message sentinel" }];

    await ghostwriterTurn(
      client, db, 1, generationId, logger,
      initialMessages, systemPrompt, "Existing draft",
    );

    const loggedInputs = getAiLogsForRun(db, runId).map(
      (row) => JSON.parse(row.input_messages) as LoggedSystemAndMessages,
    );
    expect(loggedInputs).toEqual(providerInputs);
    expect(loggedInputs[0]).toEqual({ system: systemPrompt, messages: initialMessages });
    expect(JSON.stringify(loggedInputs[1].messages)).toContain("tool_use");
    expect(JSON.stringify(loggedInputs[1].messages)).toContain("tool_result");
    expect(JSON.stringify(loggedInputs[1].messages)).toContain("Hook Type Analysis");
    expect(systemPrompt).toContain("Exact stored intent sentinel");
    expect(systemPrompt).toContain("Exact anchor heading sentinel");
    expect(systemPrompt).toContain("Exact supporting heading sentinel");
  });
});

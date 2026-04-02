import { describe, it, expect } from "vitest";
import { expandMessageRow, CLEARED_TOOL_RESULT } from "../ai/agent-loop.js";

describe("expandMessageRow", () => {
  it("returns plain message for legacy rows (null tool_blocks_json)", () => {
    const row = { role: "assistant", content: "Hello there", tool_blocks_json: null };
    const result = expandMessageRow(row, true);
    expect(result).toEqual([{ role: "assistant", content: "Hello there" }]);
  });

  it("returns plain message for legacy rows regardless of isRecent", () => {
    const row = { role: "user", content: "Hi", tool_blocks_json: null };
    const result = expandMessageRow(row, false);
    expect(result).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("expands tool blocks fully when isRecent is true", () => {
    const toolBlocks = [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_rules", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "rules here" }] },
    ];
    const row = {
      role: "assistant",
      content: "Final text",
      tool_blocks_json: JSON.stringify(toolBlocks),
    };

    const result = expandMessageRow(row, true);
    expect(result).toHaveLength(3); // assistant tool_use + user tool_result + assistant text
    expect(result[0].role).toBe("assistant");
    expect(result[1].role).toBe("user");
    expect(result[1].content[0].content).toBe("rules here"); // NOT cleared
    expect(result[2]).toEqual({ role: "assistant", content: "Final text" });
  });

  it("compacts tool results when isRecent is false", () => {
    const toolBlocks = [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_rules", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "rules here" }] },
    ];
    const row = {
      role: "assistant",
      content: "Final text",
      tool_blocks_json: JSON.stringify(toolBlocks),
    };

    const result = expandMessageRow(row, false);
    expect(result).toHaveLength(3);
    expect(result[1].content[0].content).toBe(CLEARED_TOOL_RESULT);
  });

  it("does not compact non-tool_result blocks in user messages", () => {
    const toolBlocks = [
      { role: "user", content: [{ type: "text", text: "some context" }] },
    ];
    const row = {
      role: "user",
      content: "User message",
      tool_blocks_json: JSON.stringify(toolBlocks),
    };

    const result = expandMessageRow(row, false);
    expect(result[0].content[0]).toEqual({ type: "text", text: "some context" });
  });

  it("falls back to plain message on corrupt JSON", () => {
    const row = {
      role: "assistant",
      content: "Fallback text",
      tool_blocks_json: "not valid json {{{",
    };

    const result = expandMessageRow(row, true);
    expect(result).toEqual([{ role: "assistant", content: "Fallback text" }]);
  });

  it("does not append assistant text for user-role rows", () => {
    const toolBlocks = [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "foo", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "bar" }] },
    ];
    const row = {
      role: "user",
      content: "User said this",
      tool_blocks_json: JSON.stringify(toolBlocks),
    };

    const result = expandMessageRow(row, true);
    // Should have the 2 tool blocks but NOT an extra user text message appended
    expect(result).toHaveLength(2);
  });
});

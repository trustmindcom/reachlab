import type Anthropic from "@anthropic-ai/sdk";

/**
 * Create a mock Anthropic client that returns pre-configured responses.
 * Each call to messages.create() returns the next response in the array.
 */
export function mockClient(
  responses: Array<Partial<Anthropic.Messages.Message>>
): Anthropic {
  let callIndex = 0;
  return {
    messages: {
      create: async () => {
        if (callIndex >= responses.length) {
          throw new Error("Mock client: no more responses");
        }
        return responses[callIndex++] as Anthropic.Messages.Message;
      },
    },
  } as unknown as Anthropic;
}

/**
 * Helper to build a mock text response (stop_reason: "end_turn").
 * Uses `as any` casts to avoid fighting SDK type requirements for
 * optional fields like `citations` that don't matter in tests.
 */
export function textResponse(
  text: string,
  usage?: Partial<Anthropic.Messages.Usage>
): Partial<Anthropic.Messages.Message> {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "mock",
    stop_reason: "end_turn",
    content: [{ type: "text", text, citations: null } as any],
    usage: {
      input_tokens: usage?.input_tokens ?? 100,
      output_tokens: usage?.output_tokens ?? 50,
    } as Anthropic.Messages.Usage,
  };
}

/**
 * Helper to build a mock tool_use response.
 */
export function toolUseResponse(
  tools: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  opts?: { text?: string; usage?: Partial<Anthropic.Messages.Usage> }
): Partial<Anthropic.Messages.Message> {
  const content: any[] = [];
  if (opts?.text) {
    content.push({ type: "text", text: opts.text, citations: null });
  }
  for (const tool of tools) {
    content.push({
      type: "tool_use",
      id: tool.id,
      name: tool.name,
      input: tool.input,
    });
  }
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "mock",
    stop_reason: "tool_use",
    content,
    usage: {
      input_tokens: opts?.usage?.input_tokens ?? 100,
      output_tokens: opts?.usage?.output_tokens ?? 50,
    } as Anthropic.Messages.Usage,
  };
}

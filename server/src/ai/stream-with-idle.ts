import Anthropic from "@anthropic-ai/sdk";
import type { MessageStreamParams } from "@anthropic-ai/sdk/resources/index.js";

export class StreamIdleTimeoutError extends Error {
  constructor(idleTimeoutMs: number) {
    super(`Stream idle timeout after ${idleTimeoutMs}ms`);
    this.name = "StreamIdleTimeoutError";
  }
}

export class StreamDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`Stream hard deadline exceeded after ${deadlineMs}ms`);
    this.name = "StreamDeadlineError";
  }
}

export interface StreamResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
}

/**
 * Streams a message with idle timeout and hard deadline.
 *
 * @param client - Anthropic client instance
 * @param params - Message creation params (same shape as `client.messages.create`,
 *   minus `stream` — the SDK's `MessageStreamParams` type handles this)
 * @param opts.idleTimeoutMs - Max ms between token/thinking events before aborting (default 30s)
 * @param opts.deadlineMs - Hard deadline for the entire call (default 5 min).
 *   Protects against a model that emits one token per 29s, which would never
 *   trigger idle timeout but still run forever.
 */
export async function streamWithIdleTimeout(
  client: Anthropic,
  params: MessageStreamParams,
  opts?: { idleTimeoutMs?: number; deadlineMs?: number; maxRetries?: number }
): Promise<StreamResult> {
  const idleTimeoutMs = opts?.idleTimeoutMs ?? 30_000;
  const deadlineMs = opts?.deadlineMs ?? 300_000; // 5 minutes
  const maxRetries = opts?.maxRetries ?? 0;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await _streamOnce(client, params, idleTimeoutMs, deadlineMs);
    } catch (err: any) {
      lastError = err;
      // Don't retry on our own timeout errors — the model is likely stuck
      if (
        err instanceof StreamIdleTimeoutError ||
        err instanceof StreamDeadlineError
      ) {
        throw err;
      }
      if (attempt < maxRetries) continue;
    }
  }
  throw lastError;
}

function _streamOnce(
  client: Anthropic,
  params: MessageStreamParams,
  idleTimeoutMs: number,
  deadlineMs: number
): Promise<StreamResult> {
  return new Promise<StreamResult>((resolve, reject) => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    function cleanup() {
      if (idleTimer) clearTimeout(idleTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }

    function settle(action: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    }

    function resetIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      if (settled) return;
      idleTimer = setTimeout(() => {
        // settle (reject) BEFORE aborting so our StreamIdleTimeoutError
        // wins the race, not the SDK's APIUserAbortError. Abort is inside
        // the callback so it only runs when we actually settle (not when
        // the stream already completed successfully).
        settle(() => {
          reject(new StreamIdleTimeoutError(idleTimeoutMs));
          stream.abort();
        });
      }, idleTimeoutMs);
    }

    const stream = client.messages.stream(params);

    // Do NOT start the idle timer here. During TTFB (cold start,
    // OpenRouter routing) there are legitimately no events. The idle
    // timer starts on the first text/thinking/contentBlock event.

    // Hard deadline — catches "one token per 29s" pathology and
    // also covers the TTFB window the idle timer intentionally skips.
    deadlineTimer = setTimeout(() => {
      settle(() => {
        reject(new StreamDeadlineError(deadlineMs));
        stream.abort();
      });
    }, deadlineMs);

    // Reset idle timer on text deltas
    stream.on("text", () => {
      if (!settled) resetIdleTimer();
    });

    // Reset idle timer on thinking events (extended thinking models)
    stream.on("thinking", () => {
      if (!settled) resetIdleTimer();
    });

    // Reset idle timer on content block — signals model is
    // actively producing output even before text/thinking deltas arrive
    stream.on("contentBlock", () => {
      if (!settled) resetIdleTimer();
    });

    // Final message — extract text and usage
    stream.on("finalMessage", (message) => {
      // Concatenate ALL text blocks, not just the first one
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const usage = message.usage as unknown as Record<string, number>;
      settle(() =>
        resolve({
          text,
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          thinking_tokens: usage.thinking_tokens ?? 0,
        })
      );
    });

    // SDK emits 'abort' (not 'error') when stream.abort() is called.
    // Our idle/deadline timers call settle(reject) before aborting, so
    // this is just a safety net for external aborts.
    stream.on("abort", (err) => {
      settle(() => reject(err));
    });

    stream.on("error", (err) => {
      settle(() => reject(err));
    });

    // Safety net: if the stream ends without emitting 'finalMessage'
    // (e.g., server closes connection), reject instead of hanging forever.
    stream.on("end", () => {
      settle(() =>
        reject(new Error("Stream ended without producing a final message"))
      );
    });
  });
}

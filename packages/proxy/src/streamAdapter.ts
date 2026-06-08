import { ErrorCodes } from "@ccagent/core";

export async function* openAIStreamToAnthropicEvents(
  chunks: AsyncIterable<string> | Iterable<string>
): AsyncIterable<string> {
  let started = false;
  let stopped = false;

  for await (const rawChunk of chunks) {
    const line = rawChunk.trim();
    if (!line || !line.startsWith("data:")) {
      continue;
    }

    const data = line.slice("data:".length).trim();
    if (data === "[DONE]") {
      if (started && !stopped) {
        yield sse("content_block_stop", { type: "content_block_stop", index: 0 });
        yield sse("message_stop", { type: "message_stop" });
      }
      stopped = true;
      break;
    }

    let parsed: { choices?: Array<{ delta?: { content?: string } }> };
    try {
      parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
    } catch {
      yield sse("error", {
        type: "error",
        error: {
          code: ErrorCodes.ParseError,
          message: "Malformed OpenAI stream JSON"
        }
      });
      return;
    }

    const text = parsed.choices?.[0]?.delta?.content;
    if (!text) {
      continue;
    }

    if (!started) {
      yield sse("message_start", { type: "message_start", message: { role: "assistant" } });
      yield sse("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" }
      });
      started = true;
    }

    yield sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text }
    });
  }

  if (started && !stopped) {
    yield sse("error", {
      type: "error",
      error: {
        code: ErrorCodes.ParseError,
        message: "OpenAI stream closed before [DONE]"
      }
    });
  }
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

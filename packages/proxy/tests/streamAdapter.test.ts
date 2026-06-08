import { describe, expect, test } from "vitest";
import { openAIStreamToAnthropicEvents } from "../src/index.js";

describe("stream adapter", () => {
  test("single OpenAI delta emits Anthropic event sequence", async () => {
    const events = await collect(
      openAIStreamToAnthropicEvents([
        'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}',
        "data: [DONE]"
      ])
    );

    expect(events.join("")).toContain("event: message_start");
    expect(events.join("")).toContain("event: content_block_start");
    expect(events.join("")).toContain('"text":"Hi"');
    expect(events.join("")).toContain("event: message_stop");
  });

  test("malformed JSON emits error event and stops", async () => {
    const events = await collect(openAIStreamToAnthropicEvents(["data: {bad json"]));

    expect(events.join("")).toContain("event: error");
    expect(events.join("")).toContain("CCAGENT_PARSE_ERROR");
  });
});

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

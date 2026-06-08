import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ErrorCodes } from "@ccagent/core";
import {
  anthropicToOpenAI,
  openAIToAnthropic,
  type AnthropicMessageResponse,
  type AnthropicMessagesRequest,
  type OpenAIChatRequest,
  type OpenAIChatResponse
} from "../src/index.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const anthropicRequest = readFixture<AnthropicMessagesRequest>("anthropic-message-basic.json");
const expectedOpenAIRequest = readFixture<OpenAIChatRequest>("openai-chat-basic.json");
const openAIResponse = readFixture<OpenAIChatResponse>("openai-chat-response-basic.json");
const expectedAnthropicResponse = readFixture<AnthropicMessageResponse>(
  "anthropic-response-basic.json"
);

describe("Anthropic/OpenAI conversion", () => {
  test("converts basic Anthropic request to OpenAI chat request", () => {
    expect(anthropicToOpenAI(anthropicRequest)).toEqual(expectedOpenAIRequest);
  });

  test("converts basic OpenAI response to Anthropic message response", () => {
    expect(openAIToAnthropic(openAIResponse)).toEqual(expectedAnthropicResponse);
  });

  test("rejects unsupported content block", () => {
    expect(() => {
      anthropicToOpenAI({
        ...anthropicRequest,
        messages: [{ role: "user", content: [{ type: "image", source: {} }] }]
      });
    }).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.ProxyUnsupported
      })
    );
  });
});

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8")) as T;
}

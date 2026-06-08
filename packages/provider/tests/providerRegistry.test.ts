import { describe, expect, test } from "vitest";
import { CCAgentError, ErrorCodes } from "@ccagent/core";
import { createBuiltInProviders, InMemoryProviderStore, ProviderRegistry } from "../src/index.js";

describe("provider registry", () => {
  test("creates built-in GLM and DeepSeek provider templates", () => {
    const providers = createBuiltInProviders();

    expect(providers.glm.mode).toBe("openai-compatible");
    expect(providers.glm.models.review).toBe("glm-5.1");
    expect(providers.deepseek.mode).toBe("openai-compatible");
    expect(providers.deepseek.models.default).toBe("deepseek-v4-flash");
  });

  test("resolves explicit model before review and default fallback", async () => {
    const registry = new ProviderRegistry(new InMemoryProviderStore());
    await registry.saveProvider(createBuiltInProviders().glm);

    await expect(registry.resolveModel("glm", "custom-model")).resolves.toBe("custom-model");
    await expect(registry.resolveModel("glm")).resolves.toBe("glm-5.1");
  });

  test("falls back to default model when review model is missing", async () => {
    const registry = new ProviderRegistry(new InMemoryProviderStore());
    const provider = createBuiltInProviders().deepseek;
    delete provider.models.review;
    await registry.saveProvider(provider);

    await expect(registry.resolveModel("deepseek")).resolves.toBe("deepseek-v4-flash");
  });

  test("rejects disabled providers", async () => {
    const registry = new ProviderRegistry(new InMemoryProviderStore());
    const provider = createBuiltInProviders().glm;
    provider.enabled = false;
    await registry.saveProvider(provider);

    await expect(registry.getEnabledProvider("glm")).rejects.toMatchObject({
      code: ErrorCodes.ProviderDisabled
    } satisfies Partial<CCAgentError>);
  });

  test("missing provider throws structured error", async () => {
    const registry = new ProviderRegistry(new InMemoryProviderStore());

    await expect(registry.getEnabledProvider("missing")).rejects.toMatchObject({
      code: ErrorCodes.ProviderMissing
    } satisfies Partial<CCAgentError>);
  });
});

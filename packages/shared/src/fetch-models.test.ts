import { describe, expect, it, vi } from "vitest";
import { fetchOpenAiCompatibleModels, resolveProviderApiKey } from "./fetch-models.js";

describe("fetchOpenAiCompatibleModels", () => {
  it("parses OpenAI-style data array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              { id: "gpt-4o-mini", name: "GPT-4o Mini" },
              { id: "gpt-4o" },
            ],
          }),
      }),
    );

    const models = await fetchOpenAiCompatibleModels(
      "https://api.openai.com/v1",
      "sk-test",
    );
    expect(models).toEqual([
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o" },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("throws on empty model list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: [] }),
      }),
    );

    await expect(
      fetchOpenAiCompatibleModels("https://api.example.com/v1"),
    ).rejects.toThrow(/无可用模型/);
    vi.unstubAllGlobals();
  });
});

describe("resolveProviderApiKey", () => {
  it("reads direct api key", () => {
    expect(resolveProviderApiKey({ auth: { apiKey: " public " } })).toBe("public");
  });
});

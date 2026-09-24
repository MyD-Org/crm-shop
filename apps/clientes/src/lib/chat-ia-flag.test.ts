import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { chatIaHabilitado } from "./chat-ia-flag";
import { aiApiConfig, normalizarUrlAiApi } from "./ai-api-config";

/** Lee el flag `chat-ia` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("chatIaHabilitado", () => {
  beforeEach(() => {
    vi.stubEnv("AI_API_URL", "https://ai.plataforma.example");
    vi.stubEnv("AI_API_KEY", "clave-de-prueba");
    vi.stubEnv("AI_AGENT_ID", "agente-1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apagado por defecto", async () => {
    expect(await chatIaHabilitado()).toBe(false);
  });

  it("prendido con la config completa", async () => {
    setFlag("chat-ia", true);
    expect(await chatIaHabilitado()).toBe(true);
  });

  it.each(["AI_API_URL", "AI_API_KEY", "AI_AGENT_ID"])("prendido pero sin %s ⇒ false", async (env) => {
    setFlag("chat-ia", true);
    vi.stubEnv(env, "");
    expect(await chatIaHabilitado()).toBe(false);
  });
});

describe("aiApiConfig", () => {
  it("normaliza la URL y recorta espacios", () => {
    expect(
      aiApiConfig({ AI_API_URL: " https://ai.plataforma.example/ ", AI_API_KEY: " k ", AI_AGENT_ID: " a " }),
    ).toEqual({ url: "https://ai.plataforma.example", apiKey: "k", agentId: "a" });
  });

  it("URL inválida o sin http(s) ⇒ null", () => {
    expect(normalizarUrlAiApi("no es url")).toBeNull();
    expect(normalizarUrlAiApi("ftp://ai.plataforma.example")).toBeNull();
    expect(normalizarUrlAiApi(undefined)).toBeNull();
  });
});

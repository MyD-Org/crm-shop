import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLabels } from "@myd-org/ai-widget/preset";
import { setFlag } from "@/test/flags";
import { COLOR_CHAT, ETIQUETAS_CHAT, SUBTITULO_CHAT } from "./chat-ia-textos";

const datosTenant = vi.fn();
vi.mock("./cuenta-corriente/tenant-cc", () => ({ datosTenant: () => datosTenant() }));

import { propsChatIa } from "./chat-ia";

/** Misma regla de registro que la guarda de Mi cuenta (sin-literales.test.ts). */
const REGISTRO = /\b(?:tu|tus|te|vos|sos|probá|revisá|ingresá|vinculá|elegí|escribinos|podés|tenés|dale)\b/i;
/** Imperativo voseante terminado en "á" ("Recargá", "Intentá"); "Escribí" lo cubre la línea explícita. */
const VOSEO_A = /\p{L}á(?!\p{L})/u;

/** CHAT-1: con el flag apagado el layout no monta nada ni toca la base. */
describe("propsChatIa", () => {
  beforeEach(() => {
    vi.stubEnv("AI_API_URL", "https://ai.plataforma.example");
    vi.stubEnv("AI_API_KEY", "clave-secreta");
    vi.stubEnv("AI_AGENT_ID", "agente-1");
    datosTenant.mockReset();
    datosTenant.mockResolvedValue({ id: "t", nombre: "Tienda Demo", whatsapp: null, mailComprobantes: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("flag apagado ⇒ null sin leer el tenant", async () => {
    expect(await propsChatIa()).toBeNull();
    expect(datosTenant).not.toHaveBeenCalled();
  });

  it("flag prendido sin config ⇒ null", async () => {
    setFlag("chat-ia", true);
    vi.stubEnv("AI_AGENT_ID", "");
    expect(await propsChatIa()).toBeNull();
  });

  it("prendido ⇒ sólo datos públicos (agente y nombre del tenant), nunca la key", async () => {
    setFlag("chat-ia", true);
    const props = await propsChatIa();
    expect(props).toEqual({ agentId: "agente-1", titulo: "Tienda Demo" });
    expect(JSON.stringify(props)).not.toContain("clave-secreta");
  });

  it("tenant ilegible ⇒ título genérico, el chat igual se monta", async () => {
    setFlag("chat-ia", true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    datosTenant.mockRejectedValue(new Error("db caída"));
    expect(await propsChatIa()).toEqual({ agentId: "agente-1", titulo: "Asistente" });
    log.mockRestore();
  });
});

describe("textos del widget", () => {
  it("pisa TODAS las etiquetas del widget", () => {
    expect(Object.keys(ETIQUETAS_CHAT).sort()).toEqual(Object.keys(defaultLabels).sort());
  });

  it("en usted, sin voseo ni tuteo", () => {
    for (const texto of [...Object.values(ETIQUETAS_CHAT), SUBTITULO_CHAT]) {
      expect(texto).not.toMatch(REGISTRO);
      expect(texto).not.toMatch(VOSEO_A);
      expect(texto).not.toMatch(/Escribí|Recargá|Probá|Intentá/);
    }
  });

  it("color desde el token del DS, no un literal", () => {
    expect(COLOR_CHAT).toBe("var(--color-primary)");
  });
});

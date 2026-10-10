import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLabels } from "@myd-org/ai-widget/preset";
import { setFlag } from "@/test/flags";
import { COLOR_CHAT, ETIQUETAS_CHAT, SUBTITULO_CHAT, SUGERENCIAS_CHAT } from "./chat-ia-textos";

const datosTenant = vi.fn();
const identidad = vi.fn();
const textosChat = vi.fn();
vi.mock("./cuenta-corriente/tenant-cc", () => ({ datosTenant: () => datosTenant() }));
vi.mock("./chat-ia-textos-tenant", () => ({ textosChatTenant: () => textosChat() }));
vi.mock("./auth", () => ({ identidadActual: () => identidad() }));

import { propsChatIa } from "./chat-ia";

/** Voseo o tuteo: misma lista que la guarda de Mi cuenta (sin-literales.test.ts). */
const REGISTRO = /\b(?:tu|tus|te|vos|sos|probá|revisá|ingresá|vinculá|elegí|escribinos|podés|tenés|dale)\b/i;
/** Usted: la UI del chat es neutra (CLAUDE.md, excepción del asistente vendedor). */
const USTED = /\b(?:usted|su|sus|le|les)\b|Inténtelo|Recargue|Ingrese|Seleccione|Escriba|Indique|Espere/i;
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
    textosChat.mockReset();
    textosChat.mockResolvedValue({ emptyState: "Consultas de la tienda", suggestions: ["Ver ofertas"] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("flag apagado ⇒ null sin leer el tenant", async () => {
    expect(await propsChatIa()).toBeNull();
    expect(datosTenant).not.toHaveBeenCalled();
    expect(textosChat).not.toHaveBeenCalled();
  });

  it("flag prendido sin config ⇒ null", async () => {
    setFlag("chat-ia", true);
    vi.stubEnv("AI_AGENT_ID", "");
    expect(await propsChatIa()).toBeNull();
  });

  it("prendido ⇒ sólo datos públicos (agente, nombre del tenant y textos del chat), nunca la key", async () => {
    setFlag("chat-ia", true);
    const props = await propsChatIa();
    expect(props).toEqual({
      agentId: "agente-1",
      titulo: "Tienda Demo",
      textoVacio: "Consultas de la tienda",
      sugerencias: ["Ver ofertas"],
    });
    expect(JSON.stringify(props)).not.toContain("clave-secreta");
  });

  it("con AI_AGENT_ID_CLIENTE, el vinculado usa ese agente y el resto el general", async () => {
    setFlag("chat-ia", true);
    vi.stubEnv("AI_AGENT_ID_CLIENTE", "agente-cliente");
    identidad.mockResolvedValue({ cliente: { codigocliente: "42" } });
    expect((await propsChatIa())?.agentId).toBe("agente-cliente");
    identidad.mockResolvedValue({ cliente: null });
    expect((await propsChatIa())?.agentId).toBe("agente-1");
    identidad.mockRejectedValue(new Error("clerk caído"));
    expect((await propsChatIa())?.agentId).toBe("agente-1");
  });

  it("sin AI_AGENT_ID_CLIENTE no lee la identidad", async () => {
    setFlag("chat-ia", true);
    identidad.mockReset();
    await propsChatIa();
    expect(identidad).not.toHaveBeenCalled();
  });

  it("tenant ilegible ⇒ título genérico, el chat igual se monta", async () => {
    setFlag("chat-ia", true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    datosTenant.mockRejectedValue(new Error("db caída"));
    expect(await propsChatIa()).toMatchObject({ agentId: "agente-1", titulo: "Asistente" });
    log.mockRestore();
  });
});

describe("textos del widget", () => {
  it("pisa TODAS las etiquetas del widget", () => {
    expect(Object.keys(ETIQUETAS_CHAT).sort()).toEqual(Object.keys(defaultLabels).sort());
  });

  it("en registro neutro: sin voseo, sin tuteo y sin usted", () => {
    for (const texto of [...Object.values(ETIQUETAS_CHAT), SUBTITULO_CHAT, ...SUGERENCIAS_CHAT]) {
      expect(texto).not.toMatch(REGISTRO);
      expect(texto).not.toMatch(VOSEO_A);
      expect(texto).not.toMatch(/Escribí|Recargá|Probá|Intentá/);
      expect(texto).not.toMatch(USTED);
    }
  });

  it("color desde el token del DS, no un literal", () => {
    expect(COLOR_CHAT).toBe("var(--color-primary)");
  });
});

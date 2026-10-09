import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";
import { ETIQUETAS_CHAT, SUGERENCIAS_CHAT } from "./chat-ia-textos";

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { conDefaults, textosChatTenant } from "./chat-ia-textos-tenant";

const POR_DEFECTO = { emptyState: ETIQUETAS_CHAT.emptyState, suggestions: SUGERENCIAS_CHAT };

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("textosChatTenant", () => {
  it("lee sólo las columnas del GRANT (0078), del tenant del Shop", async () => {
    grabadora = dbGrabadora(() => [["Consultas de la tienda", ["Ver ofertas", "Horarios del local"]]]);
    expect(await textosChatTenant()).toEqual({
      emptyState: "Consultas de la tienda",
      suggestions: ["Ver ofertas", "Horarios del local"],
    });
    const [consulta] = grabadora.consultas;
    expect(consulta.sql).toMatch(
      /^select "chat_empty_state", "chat_suggestions" from "public"\."tenants" where "public"\."tenants"\."id" = \$1/,
    );
    expect(consulta.params[0]).toBe("tenant-test");
  });

  it("vacíos ⇒ los textos actuales del Shop, campo por campo", async () => {
    grabadora = dbGrabadora(() => [["", []]]);
    expect(await textosChatTenant()).toEqual(POR_DEFECTO);
    grabadora = dbGrabadora(() => [["Hola", []]]);
    expect(await textosChatTenant()).toEqual({ emptyState: "Hola", suggestions: SUGERENCIAS_CHAT });
    grabadora = dbGrabadora(() => [["  ", ["Una"]]]);
    expect(await textosChatTenant()).toEqual({ emptyState: ETIQUETAS_CHAT.emptyState, suggestions: ["Una"] });
  });

  it("sin fila o con la base caída ⇒ textos por defecto, sin tirar", async () => {
    grabadora = dbGrabadora(() => []);
    expect(await textosChatTenant()).toEqual(POR_DEFECTO);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    grabadora = dbGrabadora(() => {
      throw new Error("permission denied for column chat_suggestions");
    });
    expect(await textosChatTenant()).toEqual(POR_DEFECTO);
    log.mockRestore();
  });
});

describe("conDefaults", () => {
  it("fila tocada a mano: descarta lo que no es texto, recorta y deja hasta 4", () => {
    expect(conDefaults({ chatEmptyState: 5, chatSuggestions: "no es array" })).toEqual(POR_DEFECTO);
    expect(
      conDefaults({ chatEmptyState: "x".repeat(200), chatSuggestions: [1, " A ", "", "B", "C", "D", "E"] }),
    ).toEqual({ emptyState: "x".repeat(120), suggestions: ["A", "B", "C", "D"] });
  });

  it("no comparte el array por defecto (mutarlo no pisa la constante)", () => {
    const { suggestions } = conDefaults(null);
    expect(suggestions).not.toBe(SUGERENCIAS_CHAT);
  });
});

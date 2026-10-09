import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alta masiva de favoritos: sólo Clerk, rate limit propio (5/min), valida los
 * ids contra el catálogo y nunca devuelve 422 por el tope.
 */

let userId: string | null = "user_1";
let permitido = true;
const permitir = vi.fn<(...a: unknown[]) => boolean>(() => permitido);
const agregarFavoritosLote = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const getProductosPorIds = vi.fn<(...a: unknown[]) => Promise<Map<string, unknown>>>();
let soloVisibles = true;

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId }) }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async (...a: unknown[]) => permitir(...a) }));
vi.mock("@/lib/catalogo-flag", () => ({ catalogoSoloVisibles: async () => soloVisibles }));
vi.mock("@/lib/catalog", () => ({ getProductosPorIds: (...a: unknown[]) => getProductosPorIds(...a) }));
vi.mock("@/lib/favoritos", () => ({
  MAX_FAVORITOS: 200,
  agregarFavoritosLote: (...a: unknown[]) => agregarFavoritosLote(...a),
}));

import { POST } from "./route";

const pedir = (body: unknown) =>
  POST(
    new Request("http://localhost/api/mi-cuenta/favoritos/lote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const catalogo = (...ids: string[]) => new Map(ids.map((id) => [id, {}]));

beforeEach(() => {
  userId = "user_1";
  permitido = true;
  soloVisibles = true;
  permitir.mockClear();
  agregarFavoritosLote.mockReset();
  getProductosPorIds.mockReset();
  getProductosPorIds.mockImplementation(async (ids) => catalogo(...(ids as string[])));
  agregarFavoritosLote.mockImplementation(async (_u, ids) => ({
    agregados: ids as string[],
    yaEstaban: 0,
    sinLugar: 0,
    ids: ids as string[],
  }));
});

async function esperaError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error });
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

describe("POST /favoritos/lote", () => {
  it("401 sin sesión y no escribe", async () => {
    userId = null;
    await esperaError(await pedir({ alegraItemIds: ["1"] }), 401, "No autorizado");
    expect(agregarFavoritosLote).not.toHaveBeenCalled();
    expect(permitir).not.toHaveBeenCalled();
  });

  it("429 con clave y límite propios", async () => {
    permitido = false;
    await esperaError(
      await pedir({ alegraItemIds: ["1"] }),
      429,
      "Demasiadas solicitudes. Inténtelo de nuevo en unos minutos.",
    );
    expect(permitir).toHaveBeenCalledWith("favoritos-lote:clerk:user_1", 5, 60_000);
    expect(agregarFavoritosLote).not.toHaveBeenCalled();
  });

  it.each([
    ["body vacío", ""],
    ["no es JSON", "{"],
    ["sin array", { alegraItemIds: "1" }],
    ["array vacío", { alegraItemIds: [] }],
    ["sin campo", {}],
    ["null", "null"],
    ["más de 200", { alegraItemIds: Array.from({ length: 201 }, (_, i) => String(i + 1)) }],
    ["ninguno válido", { alegraItemIds: [1, null, "abc", "../x"] }],
  ])("400 (%s)", async (_n, body) => {
    await esperaError(await pedir(body), 400, "Indique los productos.");
    expect(agregarFavoritosLote).not.toHaveBeenCalled();
  });

  it("descarta inválidos y duplicados, y guarda sólo lo del catálogo", async () => {
    getProductosPorIds.mockResolvedValue(catalogo("12", "34"));
    const res = await pedir({ alegraItemIds: ["12", "12", "abc", 5, "34", "99"] });
    expect(getProductosPorIds).toHaveBeenCalledWith(["12", "34", "99"], {
      soloActivos: true,
      soloVisibles: true,
    });
    expect(agregarFavoritosLote).toHaveBeenCalledWith("user_1", ["12", "34"]);
    expect(await res.json()).toEqual({
      ok: true,
      ids: ["12", "34"],
      agregados: 2,
      yaEstaban: 0,
      sinLugar: 0,
      noDisponibles: 1,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("respeta el flag de catálogo sólo visibles", async () => {
    soloVisibles = false;
    await pedir({ alegraItemIds: ["1"] });
    expect(getProductosPorIds).toHaveBeenCalledWith(["1"], { soloActivos: true, soloVisibles: false });
  });

  it("tope: 200 parcial con sinLugar, nunca 422", async () => {
    agregarFavoritosLote.mockResolvedValue({ agregados: ["1"], yaEstaban: 1, sinLugar: 3, ids: ["1", "2"] });
    const res = await pedir({ alegraItemIds: ["1", "2", "3", "4", "5"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agregados: 1, yaEstaban: 1, sinLugar: 3 });
  });
});

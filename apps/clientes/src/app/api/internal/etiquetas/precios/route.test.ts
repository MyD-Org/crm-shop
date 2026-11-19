import { beforeEach, describe, expect, it, vi } from "vitest";

const getProductosPorIds = vi.fn();
const flags = vi.fn();
const campanias = vi.fn();
vi.mock("@/lib/catalog", () => ({ getProductosPorIds: (...a: unknown[]) => getProductosPorIds(...a) }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: () => flags() }));
vi.mock("@/lib/campanias/vigentes", () => ({ campaniasVigentes: () => campanias() }));

import { POST } from "./route";

const MAX_IDS_ETIQUETAS = 1000;

const DESTACADO = { slug: "transferencia", nombre: "Transferencia", idListaPrecios: "2" };

const req = (body: unknown, auth: string | null = "Bearer int-456") =>
  POST(
    new Request("http://localhost/api/internal/etiquetas/precios", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

/**
 * Contrato CRM → Shop de las etiquetas de precio: Bearer SHOP_CRM_SECRET, ids de Alegra y, por id,
 * el precio de la card (con IVA) y el del medio destacado. La cadena de precios real
 * (`getProductosPorIds` → `mapFilaToProduct`) se cubre en los tests del catálogo.
 */
describe("POST /api/internal/etiquetas/precios", () => {
  beforeEach(() => {
    process.env.SHOP_CRM_SECRET = "int-456";
    getProductosPorIds.mockReset().mockResolvedValue(new Map());
    flags.mockReset().mockResolvedValue({ mediosPrecio: { destacado: DESTACADO, ficha: [] } });
    campanias.mockReset().mockResolvedValue([]);
  });

  it("401 sin secreto válido y no consulta nada", async () => {
    expect((await req({ ids: ["1"] }, null)).status).toBe(401);
    expect((await req({ ids: ["1"] }, "Bearer nope")).status).toBe(401);
    expect(getProductosPorIds).not.toHaveBeenCalled();
  });

  it("400 con un body que no es { ids: [...] } o con demasiados ids", async () => {
    expect((await req("no json")).status).toBe(400);
    expect((await req({ ids: "1" })).status).toBe(400);
    expect((await req({ ids: Array.from({ length: MAX_IDS_ETIQUETAS + 1 }, (_, i) => String(i)) })).status).toBe(400);
  });

  it("descarta ids inválidos y duplicados; sin ids válidos no consulta", async () => {
    const res = await req({ ids: ["../x", 3, "abc"] });
    expect(await res.json()).toEqual({ precios: {} });
    expect(getProductosPorIds).not.toHaveBeenCalled();
    await req({ ids: ["1", "1", "mdp:2"] });
    expect(getProductosPorIds.mock.calls[0][0]).toEqual(["1", "mdp:2"]);
  });

  it("precio público de la card con el medio destacado (sin lista privada ni filtro de publicado)", async () => {
    getProductosPorIds.mockResolvedValue(
      new Map([
        ["1", { id: "1", price: 37933.88, precioFinal: 45900, precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 34140.5, precioFinal: 41310 } }],
        ["2", { id: "2", price: 1000, precioMedio: { slug: "mercadopago", nombre: "Mercado Pago", price: 900, forma: "debito" } }],
        ["3", { id: "3", price: 0 }],
      ]),
    );
    const res = await req({ ids: ["1", "2", "3", "4"] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(getProductosPorIds).toHaveBeenCalledWith(["1", "2", "3", "4"], {
      mediosPrecio: { destacado: DESTACADO, ficha: [] },
    });
    expect(await res.json()).toEqual({
      precios: {
        "1": { precioLista: 45900, precioMedio: { nombre: "Transferencia", rotulo: "con Transferencia", precio: 41310 } },
        "2": { precioLista: 1000, precioMedio: { nombre: "Mercado Pago", rotulo: "con débito", precio: 900 } },
        "3": { precioLista: null, precioMedio: null },
      },
    });
  });

  it("con campañas activas las pasa, como las cards", async () => {
    const activa = { id: "c1", nombre: "Hot Sale", etiqueta: "HOT", fin: "2026-12-01T00:00:00Z" };
    campanias.mockResolvedValue([activa]);
    flags.mockResolvedValue({ mediosPrecio: { destacado: null, ficha: [] } });
    await req({ ids: ["1"] });
    expect(getProductosPorIds).toHaveBeenCalledWith(["1"], {
      mediosPrecio: { destacado: null, ficha: [], campanias: [activa] },
    });
  });

  it("sin medio destacado ni campañas: el producto de siempre", async () => {
    flags.mockResolvedValue({ mediosPrecio: { destacado: null, ficha: [] } });
    await req({ ids: ["1"] });
    expect(getProductosPorIds).toHaveBeenCalledWith(["1"], {});
  });

  it("502 si la base falla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getProductosPorIds.mockRejectedValue(new Error("db"));
    const res = await req({ ids: ["1"] });
    expect(res.status).toBe(502);
  });
});

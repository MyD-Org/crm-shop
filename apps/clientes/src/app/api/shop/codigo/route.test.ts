import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const pedidos: { skus: readonly string[]; opts: Record<string, unknown> }[] = [];
let respuesta: { id: string }[] = [];
let falla = false;

vi.mock("@/lib/catalog", () => ({
  getProductosPorSkus: async (skus: readonly string[], opts: Record<string, unknown>) => {
    pedidos.push({ skus, opts });
    if (falla) throw new Error("db caída");
    return respuesta;
  },
}));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true, variantes: true }) }));
vi.mock("@/lib/zona-servidor", () => ({ dispCatalogo: async () => undefined }));

const { GET } = await import("./route");
const pedir = async (c?: string) => {
  const url = new URL("http://localhost/api/shop/codigo");
  if (c !== undefined) url.searchParams.set("c", c);
  const res = await GET(new NextRequest(url));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  pedidos.length = 0;
  respuesta = [];
  falla = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/shop/codigo", () => {
  it("un producto con ese código: su id, con los filtros de la lista pública", async () => {
    respuesta = [{ id: "42" }];
    expect(await pedir(" VOLKAN-BLACK-40 ")).toEqual({ status: 200, body: { id: "42" } });
    expect(pedidos).toEqual([{ skus: ["VOLKAN-BLACK-40"], opts: { soloVisibles: true, agrupar: true, disp: undefined } }]);
  });

  it("ninguno o más de uno: null (el buscador cae a la búsqueda normal)", async () => {
    expect((await pedir("X")).body).toEqual({ id: null });
    respuesta = [{ id: "1" }, { id: "2" }];
    expect((await pedir("X")).body).toEqual({ id: null });
  });

  it("sin código o demasiado largo: null sin consultar", async () => {
    expect((await pedir()).body).toEqual({ id: null });
    expect((await pedir("x".repeat(65))).body).toEqual({ id: null });
    expect(pedidos).toHaveLength(0);
  });

  it("si falla la base: 502 con mensaje", async () => {
    falla = true;
    expect(await pedir("X")).toEqual({ status: 502, body: { error: "No se pudo buscar el código." } });
  });
});

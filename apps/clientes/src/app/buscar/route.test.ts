import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /buscar: responde 307 (nunca una página) con la URL final del catálogo,
 * y la cookie del resumen sólo cuando hubo plan. La decisión en sí está
 * probada en lib/busqueda-v2/buscar.test.ts.
 */
const habilitada = vi.fn(async () => true);
const planParaBuscar = vi.fn();
const contarCatalogo = vi.fn(async () => 0);
const despues: (() => unknown)[] = [];

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => {},
  after: (fn: () => unknown) => despues.push(fn),
}));
vi.mock("@/lib/busqueda-ia-flag", () => ({ busquedaIaHabilitada: () => habilitada() }));
vi.mock("@/lib/catalog", () => ({ contarCatalogo: () => contarCatalogo() }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: false }) }));
vi.mock("@/lib/zona-servidor", () => ({ dispCatalogo: async () => undefined }));
vi.mock("@/lib/busqueda-v2/servidor", () => ({ planParaBuscar: (...a: unknown[]) => planParaBuscar(...a) }));

import { GET } from "./route";

const pedir = (qs: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`https://tienda.example/buscar?${qs}`, { headers }));

beforeEach(() => {
  habilitada.mockResolvedValue(true);
  planParaBuscar.mockReset();
  despues.length = 0;
});

describe("GET /buscar", () => {
  it("307 a la URL con el plan, sin caché, con la cookie del resumen; la IP va al tope de Jev", async () => {
    planParaBuscar.mockResolvedValue({
      plan: {
        version: 1,
        consulta: "reflector para el patio",
        intencion: "producto",
        duros: { categorias: ["Reflectores"], atributos: [] },
        blandos: { categorias: [], atributos: [{ id: "apto-exterior", peso: 1 }], terminos: [{ texto: "reflector", peso: 1 }] },
        fuente: "jev",
      },
      msJev: 500,
    });
    const r = await pedir("q=reflector+para+el+patio&stock=todos", { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe(
      "https://tienda.example/catalogo?q=reflector+para+el+patio&categoria=Reflectores&stock=todos&ia=1",
    );
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.cookies.get("busqueda_resumen")?.value).toContain('"intencion":"producto"');
    expect(planParaBuscar).toHaveBeenCalledWith("reflector para el patio", expect.objectContaining({ ip: "203.0.113.7", soloVisibles: false }));
  });

  it("flag apagado: 307 a la búsqueda clásica, sin plan ni cookie", async () => {
    habilitada.mockResolvedValue(false);
    const r = await pedir("q=foco&stock=todos");
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://tienda.example/catalogo?q=foco&stock=todos");
    expect(r.cookies.get("busqueda_resumen")).toBeUndefined();
    expect(planParaBuscar).not.toHaveBeenCalled();
  });

  it("un código: 307 directo, sin IA", async () => {
    const r = await pedir("q=DL-18W");
    expect(r.headers.get("location")).toBe("https://tienda.example/catalogo?q=DL-18W");
    expect(planParaBuscar).not.toHaveBeenCalled();
  });
});

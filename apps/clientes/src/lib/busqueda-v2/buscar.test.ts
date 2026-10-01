import { describe, expect, it, vi } from "vitest";
import { destinoDeBusqueda, type DepsBuscar } from "./buscar";
import { planVacio, type PlanBusqueda } from "./plan";
import { COOKIE_RESUMEN, leerCookieResumen, valorCookieResumen } from "./resumen";

const plan = (cambios: Partial<PlanBusqueda> = {}): PlanBusqueda => ({
  ...planVacio("foco cálido e27"),
  intencion: "producto",
  duros: { categorias: ["Lámparas"], atributos: ["tono-calido", "zocalo-e27"] },
  blandos: { categorias: [{ nombre: "Bulbos", peso: 0.8 }], atributos: [], terminos: [{ texto: "foco", peso: 1 }, { texto: "lampara", peso: 0.7 }] },
  fuente: "jev",
  ...cambios,
});

const deps = (cambios: Partial<DepsBuscar> = {}): DepsBuscar => ({
  habilitada: async () => true,
  plan: async () => ({ plan: plan(), msJev: 420 }),
  contarClasica: async () => 0,
  ...cambios,
});

describe("/buscar: destino", () => {
  it("con plan: la consulta original, los duros como filtros e ia=1; resumen para la telemetría", async () => {
    const r = await destinoDeBusqueda({ q: "foco cálido e27", stock: "todos" }, deps());
    expect(r.href).toBe(
      "/catalogo?q=foco+c%C3%A1lido+e27&categoria=L%C3%A1mparas&atr=tono-calido&atr=zocalo-e27&stock=todos&ia=1",
    );
    expect(r.resumen).toEqual({ intencion: "producto", fuente: "jev", duros: 3, blandos: 1, ms_jev: 420 });
  });

  it("el plan y el conteo clásico corren en paralelo", async () => {
    const orden: string[] = [];
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    const r = destinoDeBusqueda(
      { q: "foco" },
      deps({
        plan: async () => {
          orden.push("plan");
          await espera;
          return { plan: plan(), msJev: 1 };
        },
        contarClasica: async () => {
          orden.push("conteo");
          soltar();
          return 3;
        },
      }),
    );
    await r;
    expect(orden).toEqual(["plan", "conteo"]);
  });

  it("flag apagado: la búsqueda clásica de siempre, sin plan", async () => {
    const planFn = vi.fn();
    const r = await destinoDeBusqueda({ q: "foco", stock: "todos" }, deps({ habilitada: async () => false, plan: planFn }));
    expect(r).toEqual({ href: "/catalogo?q=foco&stock=todos" });
    expect(planFn).not.toHaveBeenCalled();
  });

  it("un código va directo a la clásica (sin IA)", async () => {
    const planFn = vi.fn();
    expect((await destinoDeBusqueda({ q: "DL-18W" }, deps({ plan: planFn }))).href).toBe("/catalogo?q=DL-18W");
    expect(planFn).not.toHaveBeenCalled();
  });

  it("sin texto, al catálogo", async () => {
    expect((await destinoDeBusqueda({ q: "   " }, deps())).href).toBe("/catalogo");
  });

  it("un plan que no agrega nada con resultados clásicos: la clásica", async () => {
    const vacio = plan({ duros: { categorias: [], atributos: [] }, blandos: { categorias: [], atributos: [], terminos: [{ texto: "zzz", peso: 1 }] } });
    const r = await destinoDeBusqueda({ q: "zzz" }, deps({ plan: async () => ({ plan: vacio, msJev: null }), contarClasica: async () => 5 }));
    expect(r.href).toBe("/catalogo?q=zzz");
    // Sin resultados clásicos, el plan (aunque sea pobre) es mejor que nada.
    const r2 = await destinoDeBusqueda({ q: "zzz" }, deps({ plan: async () => ({ plan: vacio, msJev: null }), contarClasica: async () => 0 }));
    expect(r2.href).toBe("/catalogo?q=zzz&ia=1");
  });

  it("si el plan falla, la clásica (nunca se queda sin destino)", async () => {
    const r = await destinoDeBusqueda({ q: "foco" }, deps({ plan: async () => Promise.reject(new Error("x")) }));
    expect(r.href).toBe("/catalogo?q=foco");
  });
});

describe("resumen para la página", () => {
  it("ida y vuelta por la cookie, sin la consulta", () => {
    const r = { intencion: "pregunta" as const, fuente: "cache" as const, duros: 0, blandos: 2, ms_jev: null };
    const valor = valorCookieResumen(r);
    expect(valor).not.toContain("foco");
    expect(leerCookieResumen(encodeURIComponent(valor))).toEqual(r);
    expect(COOKIE_RESUMEN).toBe("busqueda_resumen");
  });

  it("mal formada o ausente: null", () => {
    expect(leerCookieResumen(undefined)).toBeNull();
    expect(leerCookieResumen("no-json")).toBeNull();
    expect(leerCookieResumen(encodeURIComponent(JSON.stringify({ intencion: "otra", fuente: "jev" })))).toBeNull();
  });
});

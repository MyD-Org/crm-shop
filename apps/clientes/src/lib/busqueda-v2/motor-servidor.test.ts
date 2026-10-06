import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { Product } from "@/data/products";
import type { PaginaCatalogo } from "../catalog";
import { planVacio, type PlanBusqueda } from "./plan";

/**
 * Cableado del motor con las dependencias de verdad (sin base: se espían las lecturas). Lo que se
 * fija: de dónde sale cada lectura, que el ÚNICO plan es `planParaPagina` (jamás Jev), qué política
 * corre cada superficie según el flag `busqueda-motor-unico` (apagado = `legado`) y que
 * `contarConsulta` reproduce el conteo clásico de `/buscar`.
 */
const prod = (id: string) => ({ id, name: id }) as unknown as Product;
const pagina = (n: number): PaginaCatalogo => ({ productos: Array.from({ length: n }, (_, i) => prod(`p${i}`)), total: n, pagina: 1, paginas: 1 });

const getPaginaCatalogo = vi.fn<(a: unknown) => Promise<PaginaCatalogo>>(async () => pagina(0));
const contarCatalogo = vi.fn<(a: unknown) => Promise<number>>(async () => 7);
const paginaCatalogoPublica = vi.fn<(a: unknown) => Promise<PaginaCatalogo>>(async () => pagina(0));
const facetasPublicas = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ categorias: [], marcas: [], atributos: [] }));
const planParaPagina = vi.fn<(q: string, o: unknown) => Promise<PlanBusqueda | null>>(async () => null);
const busquedaIaHabilitada = vi.fn(async () => true);

vi.mock("../catalog", () => ({
  getPaginaCatalogo: (a: unknown) => getPaginaCatalogo(a),
  contarCatalogo: (a: unknown) => contarCatalogo(a),
}));
vi.mock("../catalogo-publico", () => ({
  paginaCatalogoPublica: (a: unknown) => paginaCatalogoPublica(a),
  facetasPublicas: (...a: unknown[]) => facetasPublicas(...a),
}));
vi.mock("./servidor", () => ({ planParaPagina: (q: string, o: unknown) => planParaPagina(q, o) }));
vi.mock("../busqueda-ia-flag", () => ({ busquedaIaHabilitada: () => busquedaIaHabilitada() }));

import { SUPERFICIES_EN_CASCADA, buscarEnShop, contarConsulta, politicaDe } from "./motor-servidor";

const planConAporte: PlanBusqueda = {
  ...planVacio("panel led"),
  blandos: { categorias: [{ nombre: "Paneles", peso: 0.9 }], atributos: [], terminos: [{ texto: "panel", peso: 1 }] },
};

const pedido = (extra = {}) => ({ consulta: "panel led", filtros: {}, orden: "relevancia" as const, pagina: 1, porPagina: 8, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  getPaginaCatalogo.mockImplementation(async () => pagina(0));
  paginaCatalogoPublica.mockImplementation(async () => pagina(0));
  planParaPagina.mockImplementation(async () => null);
  busquedaIaHabilitada.mockImplementation(async () => true);
});

describe("buscarEnShop: de dónde sale cada lectura", () => {
  it("catálogo: la página sale de la caché pública (con soloVisibles, disp y destacado) y las facetas de facetasPublicas", async () => {
    const disp = { zona: "z" } as never;
    const destacado = { nombre: "Medio" } as never;
    paginaCatalogoPublica.mockImplementation(async () => pagina(2));
    const r = await buscarEnShop(
      pedido({ porPagina: 24, pagina: 2, filtros: { categorias: ["Lámparas"] } }),
      { superficie: "catalogo", soloVisibles: true, disp, destacado, conFacetas: true, busquedaIa: true },
    );
    expect(paginaCatalogoPublica).toHaveBeenCalledWith({
      filtros: { categorias: ["Lámparas"], texto: { q: "panel led" } },
      orden: "relevancia",
      pagina: 2,
      soloVisibles: true,
      disp,
      destacado,
    });
    expect(getPaginaCatalogo).not.toHaveBeenCalled();
    expect(facetasPublicas).toHaveBeenCalledWith({ categorias: ["Lámparas"], texto: { q: "panel led" } }, true, disp);
    expect(r.etapa).toBe("exacta");
  });

  it("catálogo sin texto: la lectura sigue siendo la cacheable (sin `texto`)", async () => {
    await buscarEnShop(pedido({ consulta: undefined, porPagina: 24 }), { superficie: "catalogo", soloVisibles: false, busquedaIa: true });
    expect(paginaCatalogoPublica.mock.calls[0][0]).toMatchObject({ filtros: {} });
    expect("texto" in (paginaCatalogoPublica.mock.calls[0][0] as { filtros: object }).filtros).toBe(false);
  });

  it.each(["autocompletar", "chat", "admin"] as const)("%s: getPaginaCatalogo con sinConteo y el límite como porPagina", async (superficie) => {
    getPaginaCatalogo.mockImplementation(async () => pagina(1));
    await buscarEnShop(pedido({ porPagina: 10 }), { superficie, soloVisibles: true, busquedaIa: false });
    expect(getPaginaCatalogo).toHaveBeenCalledTimes(1);
    expect(getPaginaCatalogo).toHaveBeenCalledWith({
      soloVisibles: true,
      filtros: { texto: { q: "panel led" } },
      orden: "relevancia",
      pagina: 1,
      porPagina: 10,
      disp: undefined,
      sinConteo: true,
    });
    expect(paginaCatalogoPublica).not.toHaveBeenCalled();
  });
});

describe("buscarEnShop: el plan", () => {
  const plan: PlanBusqueda = { ...planVacio("panel led"), blandos: { categorias: [], atributos: [], terminos: [{ texto: "panel", peso: 1 }] } };

  it("el único plan es planParaPagina(consulta cruda, { soloVisibles })", async () => {
    planParaPagina.mockImplementation(async () => plan);
    paginaCatalogoPublica.mockImplementation(async () => pagina(1));
    const r = await buscarEnShop(pedido({ consulta: "  panel led " , porPagina: 24 }), { superficie: "catalogo", soloVisibles: true, conPlanDeUrl: true, busquedaIa: true });
    expect(planParaPagina).toHaveBeenCalledWith("panel led", { soloVisibles: true });
    expect(r).toMatchObject({ etapa: "plan", plan });
  });

  it("catálogo sin conPlanDeUrl: no se pide plan", async () => {
    await buscarEnShop(pedido({ porPagina: 24 }), { superficie: "catalogo", soloVisibles: false, busquedaIa: true });
    expect(planParaPagina).not.toHaveBeenCalled();
  });

  it("autocompletar pide plan siempre que haya texto y busqueda-ia; el admin nunca; el chat sólo con el motor prendido", async () => {
    // Flag apagado: el chat corre el legado (exacta y tolerante), que no usa plan.
    for (const superficie of ["chat", "admin"] as const) {
      await buscarEnShop(pedido(), { superficie, soloVisibles: false, busquedaIa: true });
    }
    expect(planParaPagina).not.toHaveBeenCalled();
    await buscarEnShop(pedido(), { superficie: "autocompletar", soloVisibles: false, busquedaIa: true });
    expect(planParaPagina).toHaveBeenCalledTimes(1);
  });

  it("busqueda-ia ya evaluado por el llamador no se vuelve a leer; si falta, se lee el flag", async () => {
    await buscarEnShop(pedido(), { superficie: "autocompletar", soloVisibles: false, busquedaIa: false });
    expect(busquedaIaHabilitada).not.toHaveBeenCalled();
    expect(planParaPagina).not.toHaveBeenCalled();
    await buscarEnShop(pedido(), { superficie: "autocompletar", soloVisibles: false });
    expect(busquedaIaHabilitada).toHaveBeenCalledTimes(1);
    expect(planParaPagina).toHaveBeenCalledTimes(1);
  });

  it("si el flag no se puede leer, se busca sin plan (no es un error)", async () => {
    busquedaIaHabilitada.mockImplementation(async () => Promise.reject(new Error("flags caído")));
    getPaginaCatalogo.mockImplementation(async () => pagina(1));
    const r = await buscarEnShop(pedido(), { superficie: "autocompletar", soloVisibles: false });
    expect(r.etapa).toBe("exacta");
    expect(planParaPagina).not.toHaveBeenCalled();
  });

  it("el admin nunca lee el flag (no usa plan); el chat sí (en cascada usa el plan)", async () => {
    await buscarEnShop(pedido(), { superficie: "admin", soloVisibles: false });
    expect(busquedaIaHabilitada).not.toHaveBeenCalled();
    await buscarEnShop(pedido(), { superficie: "chat", soloVisibles: false });
    expect(busquedaIaHabilitada).toHaveBeenCalledTimes(1);
  });
});

const textos = () => getPaginaCatalogo.mock.calls.map((c) => (c[0] as { filtros: { texto?: unknown } }).filtros.texto);

describe("politicaDe", () => {
  it("flag apagado: legado en todas las superficies", () => {
    for (const superficie of ["catalogo", "autocompletar", "chat", "admin"] as const) expect(politicaDe(superficie, false)).toBe("legado");
  });

  it("flag prendido: cascada en las cuatro superficies (catálogo, autocompletar, chat y selector del admin)", () => {
    expect([...SUPERFICIES_EN_CASCADA].sort()).toEqual(["admin", "autocompletar", "catalogo", "chat"]);
    for (const superficie of ["catalogo", "autocompletar", "chat", "admin"] as const) expect(politicaDe(superficie, true)).toBe("cascada");
  });
});

describe("buscarEnShop: política y flag busqueda-motor-unico", () => {
  it("flag apagado (default): autocompletar corre el legado de siempre (plan, exacta, tolerante), sin leer nada nuevo", async () => {
    planParaPagina.mockImplementation(async () => planConAporte);
    await buscarEnShop(pedido(), { superficie: "autocompletar", soloVisibles: false, busquedaIa: true });
    expect(textos().map((t) => Object.keys(t as object).sort().join())).toEqual(["plan,q", "q", "q,tolerante"]);
  });

  it("flag prendido: el catálogo con plan corre la cascada (plan, exacta, tolerante con el plan)", async () => {
    setFlag("busqueda-motor-unico", true);
    planParaPagina.mockImplementation(async () => planConAporte);
    const r = await buscarEnShop(pedido({ porPagina: 24 }), { superficie: "catalogo", soloVisibles: true, conPlanDeUrl: true, busquedaIa: true });
    expect(r.intentos).toEqual(["plan", "exacta", "tolerante"]);
    const tolerante = (paginaCatalogoPublica.mock.calls[2][0] as { filtros: { texto: { tolerante?: boolean; plan?: unknown } } }).filtros.texto;
    expect(tolerante.tolerante).toBe(true);
    expect(tolerante.plan).toBeDefined();
  });

  it("flag prendido: un código se busca en la etapa código y no pide plan", async () => {
    setFlag("busqueda-motor-unico", true);
    getPaginaCatalogo.mockImplementation(async () => pagina(1));
    const r = await buscarEnShop(pedido({ consulta: "DL-18W" }), { superficie: "autocompletar", soloVisibles: false, busquedaIa: true });
    expect(r.etapa).toBe("codigo");
    expect(textos()).toEqual([{ q: "DL-18W", codigo: true }]);
    expect(planParaPagina).not.toHaveBeenCalled();
  });

  it("un solo interruptor: apagado, el chat y el admin vuelven al legado (sin plan); prendido, corren la cascada", async () => {
    // Apagado.
    planParaPagina.mockImplementation(async () => planConAporte);
    for (const superficie of ["chat", "admin"] as const) {
      getPaginaCatalogo.mockClear();
      const r = await buscarEnShop(pedido({ porPagina: 10 }), { superficie, soloVisibles: false, busquedaIa: true });
      expect(r.intentos).toEqual(superficie === "chat" ? ["exacta", "tolerante"] : ["exacta"]);
      expect(textos()).toEqual(superficie === "chat" ? [{ q: "panel led" }, { q: "panel led", tolerante: true }] : [{ q: "panel led" }]);
    }
    expect(planParaPagina).not.toHaveBeenCalled();
    // Prendido.
    setFlag("busqueda-motor-unico", true);
    getPaginaCatalogo.mockClear();
    const chat = await buscarEnShop(pedido({ porPagina: 10 }), { superficie: "chat", soloVisibles: true, busquedaIa: true });
    expect(chat.intentos).toEqual(["plan", "exacta", "tolerante"]);
    expect(planParaPagina).toHaveBeenCalledWith("panel led", { soloVisibles: true });
    getPaginaCatalogo.mockClear();
    const admin = await buscarEnShop(pedido({ porPagina: 20 }), { superficie: "admin", soloVisibles: true, busquedaIa: true });
    expect(admin.intentos).toEqual(["exacta", "tolerante"]);
    expect(planParaPagina).toHaveBeenCalledTimes(1);
  });

  it("chat con el motor prendido: sin filtro de stock ni conteo, el límite como porPagina y el plan sólo como blando (sin duros)", async () => {
    setFlag("busqueda-motor-unico", true);
    planParaPagina.mockImplementation(async () => ({
      ...planConAporte,
      duros: { categorias: ["Paneles"], atributos: [{ id: "tono-calido" }] },
    }) as unknown as PlanBusqueda);
    await buscarEnShop(
      pedido({ porPagina: 10, filtros: { atributosEstructurados: true } }),
      { superficie: "chat", soloVisibles: true, busquedaIa: true },
    );
    const primera = getPaginaCatalogo.mock.calls[0][0] as { sinConteo: boolean; porPagina: number; filtros: Record<string, unknown> };
    expect(primera).toMatchObject({ sinConteo: true, porPagina: 10, pagina: 1 });
    expect(primera.filtros.soloStock).toBeUndefined();
    expect(primera.filtros.categorias).toBeUndefined();
    expect(primera.filtros.atributos).toBeUndefined();
    expect(primera.filtros.atributosEstructurados).toBe(true);
  });

  it("chat con el motor prendido y busqueda-ia apagado: sin plan (exacta y tolerante)", async () => {
    setFlag("busqueda-motor-unico", true);
    planParaPagina.mockImplementation(async () => planConAporte);
    const r = await buscarEnShop(pedido({ porPagina: 10 }), { superficie: "chat", soloVisibles: false, busquedaIa: false });
    expect(r.intentos).toEqual(["exacta", "tolerante"]);
    expect(planParaPagina).not.toHaveBeenCalled();
  });

  it("chat con el motor prendido: ESPERA al plan (sin tope de tiempo) y un typo con plan se resuelve en la tolerante con el plan", async () => {
    vi.useFakeTimers();
    setFlag("busqueda-motor-unico", true);
    planParaPagina.mockImplementation(() => new Promise((resolver) => setTimeout(() => resolver(planConAporte), 5000)));
    getPaginaCatalogo.mockImplementation(async (a) => {
      const t = (a as { filtros: { texto?: { tolerante?: boolean } } }).filtros.texto;
      return pagina(t?.tolerante ? 2 : 0);
    });
    const promesa = buscarEnShop(pedido({ consulta: "panle led", porPagina: 10 }), { superficie: "chat", soloVisibles: false, busquedaIa: true });
    await vi.advanceTimersByTimeAsync(5000);
    const r = await promesa;
    vi.useRealTimers();
    expect(r.intentos).toEqual(["plan", "exacta", "tolerante"]);
    expect(r).toMatchObject({ etapa: "tolerante", total: 2 });
    expect(r.plan).not.toBeNull();
  });

  it("busqueda-ia apagado manda: con el motor prendido no hay plan ni etapa plan", async () => {
    setFlag("busqueda-motor-unico", true);
    planParaPagina.mockImplementation(async () => planConAporte);
    await buscarEnShop(pedido(), { superficie: "autocompletar", soloVisibles: false, busquedaIa: false });
    expect(planParaPagina).not.toHaveBeenCalled();
    expect(textos()).toEqual([{ q: "panel led" }, { q: "panel led", tolerante: true }]);
  });

  it("el flag ya evaluado por el llamador no se vuelve a leer", async () => {
    setFlag("busqueda-motor-unico", false);
    getPaginaCatalogo.mockImplementation(async () => pagina(1));
    const r = await buscarEnShop(pedido({ consulta: "DL-18W" }), { superficie: "autocompletar", soloVisibles: false, busquedaIa: true, motorUnico: true });
    expect(r.etapa).toBe("codigo");
    getPaginaCatalogo.mockClear();
    setFlag("busqueda-motor-unico", true);
    const r2 = await buscarEnShop(pedido({ consulta: "DL-18W" }), { superficie: "autocompletar", soloVisibles: false, busquedaIa: true, motorUnico: false });
    expect(r2.etapa).toBe("exacta");
  });

  it("si el flag no se puede evaluar: legado y ningún error", async () => {
    vi.resetModules();
    vi.doMock("../busqueda-motor-flag", () => ({ busquedaMotorUnico: async () => Promise.reject(new Error("flags caído")) }));
    const { buscarEnShop: aislada } = await import("./motor-servidor");
    getPaginaCatalogo.mockImplementation(async () => pagina(1));
    const r = await aislada(pedido({ consulta: "DL-18W" }), { superficie: "autocompletar", soloVisibles: false, busquedaIa: true });
    expect(r.etapa).toBe("exacta");
    vi.doUnmock("../busqueda-motor-flag");
  });

  it("en cascada deja un aviso `[busqueda] superficie=… etapa=… ms=…` SIN la consulta", async () => {
    setFlag("busqueda-motor-unico", true);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    getPaginaCatalogo.mockImplementation(async () => pagina(1));
    await buscarEnShop(pedido({ consulta: "consulta secreta" }), { superficie: "autocompletar", soloVisibles: false, busquedaIa: false });
    expect(info).toHaveBeenCalledTimes(1);
    const mensaje = String(info.mock.calls[0][0]);
    expect(mensaje).toMatch(/^\[busqueda\] superficie=autocompletar politica=cascada etapa=exacta ms=\d+$/);
    expect(mensaje).not.toContain("secreta");
    info.mockRestore();
  });

  it("en legado no hay aviso nuevo (conducta idéntica a la de hoy)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await buscarEnShop(pedido(), { superficie: "autocompletar", soloVisibles: false, busquedaIa: false });
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("el cableado no referencia planParaBuscar ni Jev (lectura de la fuente)", () => {
    const conComentarios = readFileSync(join(__dirname, "motor-servidor.ts"), "utf8");
    const fuente = conComentarios.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(fuente).not.toMatch(/planParaBuscar/);
    expect(fuente).not.toMatch(/jev/i);
    expect(fuente).toMatch(/planParaPagina/);
  });

  it("la página evalúa el flag junto con los demás (Promise.all inicial), nunca dentro de `use cache`", () => {
    const pagina = readFileSync(join(__dirname, "../../app/catalogo/page.tsx"), "utf8");
    expect(pagina).toMatch(/busquedaMotorUnico\(\)/);
    expect(pagina).toMatch(/motorUnico:/);
  });
});

describe("contarConsulta (el conteo clásico de /buscar)", () => {
  it("cuenta con texto { q } y los demás filtros, igual que contarClasica", async () => {
    const disp = { zona: "z" } as never;
    const n = await contarConsulta({ consulta: "panel led", filtros: { categorias: ["Lámparas"], soloStock: true }, soloVisibles: true, disp });
    expect(n).toBe(7);
    expect(contarCatalogo).toHaveBeenCalledWith({
      soloVisibles: true,
      disp,
      filtros: { categorias: ["Lámparas"], soloStock: true, texto: { q: "panel led" } },
    });
  });
});

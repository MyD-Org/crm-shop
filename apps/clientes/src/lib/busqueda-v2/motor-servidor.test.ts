import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";
import type { PaginaCatalogo } from "../catalog";
import { planVacio, type PlanBusqueda } from "./plan";

/**
 * Cableado del motor con las dependencias de verdad (sin base: se espían las lecturas). Lo que se
 * fija: de dónde sale cada lectura, que el ÚNICO plan es `planParaPagina` (jamás Jev), que el
 * motor corre en política `legado` (PR1, sin flag) y que `contarConsulta` reproduce el conteo
 * clásico de `/buscar`.
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

import { SUPERFICIES_EN_CASCADA, buscarEnShop, contarConsulta } from "./motor-servidor";

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

  it("autocompletar pide plan siempre que haya texto y busqueda-ia; chat y admin nunca", async () => {
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

  it("chat y admin no leen el flag (no usan plan)", async () => {
    for (const superficie of ["chat", "admin"] as const) await buscarEnShop(pedido(), { superficie, soloVisibles: false });
    expect(busquedaIaHabilitada).not.toHaveBeenCalled();
  });
});

describe("buscarEnShop: política", () => {
  it("PR1 corre siempre en política legado: sin flag nuevo y ninguna superficie en cascada", async () => {
    expect(SUPERFICIES_EN_CASCADA.size).toBe(0);
    // Legado de chat: exacta y luego tolerante (la cascada tendría otro orden y el chat no pide plan).
    await buscarEnShop(pedido(), { superficie: "chat", soloVisibles: false, busquedaIa: true });
    expect(getPaginaCatalogo.mock.calls.map((c) => (c[0] as { filtros: { texto?: unknown } }).filtros.texto)).toEqual([
      { q: "panel led" },
      { q: "panel led", tolerante: true },
    ]);
  });

  it("el cableado no referencia planParaBuscar ni Jev (lectura de la fuente)", () => {
    const conComentarios = readFileSync(join(__dirname, "motor-servidor.ts"), "utf8");
    const fuente = conComentarios.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(fuente).not.toMatch(/planParaBuscar/);
    expect(fuente).not.toMatch(/jev/i);
    expect(fuente).toMatch(/planParaPagina/);
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

/**
 * El oráculo `legado` y el motor del banco (política `legado`) sobre un catálogo FALSO: para cada
 * superficie y cada escenario de búsqueda (plan que resuelve, plan sin resultados, typo, código,
 * plan que no aporta, vacío) tienen que devolver los mismos ids en el mismo orden y el mismo total.
 * Es la paridad de `--paridad` sin base: lo que se prueba acá es que la FACHADA no cambia la
 * secuencia de lecturas de hoy. La paridad contra la base real la corre la usuaria (ver busqueda.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";
import type { FiltrosCatalogo } from "@/lib/catalog";

type Etapa = "plan" | "exacta" | "tolerante";
const prod = (id: string) => ({ id, name: `Producto ${id}` }) as unknown as Product;
const tabla: Record<Etapa, string[]> = { plan: [], exacta: [], tolerante: [] };
const lecturas: Etapa[] = [];
const fallan = new Set<Etapa>();
const entender = vi.fn();
const contador = vi.fn();

type Texto = { q?: string; tolerante?: boolean; plan?: unknown };
const etapaDe = (f: FiltrosCatalogo | undefined): Etapa => {
  const t: Texto = f?.texto ?? { q: f?.busqueda, tolerante: f?.busquedaTolerante, plan: f?.planBusqueda };
  return t.plan ? "plan" : t.tolerante ? "tolerante" : "exacta";
};
const leer = (etapa: Etapa, tope: number) => {
  lecturas.push(etapa);
  if (fallan.has(etapa)) throw new Error(`falló ${etapa}`);
  return tabla[etapa].slice(0, tope).map(prod);
};

vi.mock("@/lib/catalog", () => ({
  PRODUCTOS_POR_PAGINA: 24,
  getCatalogo: async (o: { tolerante?: boolean; limit?: number }) => leer(o.tolerante ? "tolerante" : "exacta", o.limit ?? 24),
  getPaginaCatalogo: async (o: { filtros?: FiltrosCatalogo; porPagina?: number; sinConteo?: boolean }) => {
    const etapa = etapaDe(o.filtros);
    const productos = leer(etapa, o.porPagina ?? 24);
    return o.sinConteo
      ? { productos, total: productos.length, pagina: 1, paginas: 1, totalExacto: false }
      : { productos, total: tabla[etapa].length, pagina: 1, paginas: 1, totalExacto: true };
  },
  contarCatalogo: async () => tabla.exacta.length,
}));
vi.mock("../entender/entender", () => ({ entender: (...a: unknown[]) => entender(...a) }));
vi.mock("../conteo", () => ({ contador: (...a: unknown[]) => contador(...a) }));

import { planVacio, type PlanBusqueda } from "../plan";
import { SUPERFICIES_BANCO, type SuperficieBanco } from "./corrida";
import { ejecutarLegado } from "./legado";
import { ejecutarMotor } from "./motor";
import { compararParidad } from "./paridad";

const planConCategoria = (q: string): PlanBusqueda => ({
  ...planVacio(q),
  duros: { categorias: ["Paneles"], atributos: [] },
  blandos: { categorias: [{ nombre: "Paneles", peso: 0.9 }], atributos: [], terminos: [{ texto: "panel", peso: 1 }] },
});
const planSinAporte = (q: string): PlanBusqueda => ({ ...planVacio(q), blandos: { categorias: [], atributos: [], terminos: [{ texto: "panel", peso: 1 }] } });

const ESCENARIOS: { nombre: string; q: string; plan: (q: string) => PlanBusqueda; tabla: Partial<Record<Etapa, string[]>>; fallan?: Etapa[] }[] = [
  { nombre: "el plan resuelve", q: "panel de interior", plan: planConCategoria, tabla: { plan: ["a", "b", "c"], exacta: ["z"] } },
  { nombre: "el plan no trae nada y la exacta sí", q: "panel de interior", plan: planConCategoria, tabla: { exacta: ["x", "y"] } },
  { nombre: "typo: sólo la tolerante", q: "panle de interior", plan: planConCategoria, tabla: { tolerante: ["t1", "t2"] } },
  { nombre: "un código", q: "DL-18W", plan: (q) => planVacio(q, "codigo"), tabla: { exacta: ["c1"] } },
  { nombre: "un código con typo: la tolerante", q: "DL-18X", plan: (q) => planVacio(q, "codigo"), tabla: { tolerante: ["c2"] } },
  { nombre: "el plan no aporta y la clásica ya trae", q: "panel led", plan: planSinAporte, tabla: { exacta: ["e1", "e2", "e3"], plan: ["p1"] } },
  { nombre: "el plan no aporta y la clásica no trae", q: "panel led", plan: planSinAporte, tabla: { plan: ["p1"], tolerante: ["t1"] } },
  { nombre: "nada en ninguna etapa", q: "xyzzy inexistente", plan: planConCategoria, tabla: {} },
  { nombre: "la tolerante falla", q: "lampra", plan: planSinAporte, tabla: {}, fallan: ["tolerante"] },
];

beforeEach(() => {
  for (const e of ["plan", "exacta", "tolerante"] as const) tabla[e] = [];
  lecturas.length = 0;
  fallan.clear();
  entender.mockReset();
  contador.mockReset();
});

const ctxBase = { arbol: [], jev: null, estructurados: true };

describe.each(["catalogo", "autocompletar", "chat"] as SuperficieBanco[])("paridad motor legado vs oráculo: %s", (superficie) => {
  const { k, conteo } = SUPERFICIES_BANCO[superficie];

  it.each(ESCENARIOS)("$nombre", async ({ q, plan, tabla: t, fallan: f }) => {
    entender.mockImplementation(async () => ({ plan: plan(q), msJev: null, jevFallo: false, consultaNorm: q }));
    const correr = async (ejecutar: (q: string, ctx: never) => Promise<{ ids?: string[]; total: number }>) => {
      for (const e of ["plan", "exacta", "tolerante"] as const) tabla[e] = t[e] ?? [];
      fallan.clear();
      for (const e of f ?? []) fallan.add(e);
      const r = await ejecutar(q, { ...ctxBase, superficie, politica: "legado" } as never);
      return { ids: r.ids ?? [], total: r.total };
    };
    const motor = await correr(ejecutarMotor as never);
    const legado = await correr(ejecutarLegado as never);
    expect(compararParidad([motor], [legado], { n: k, conteo })).toEqual({ n: k, casos: 1, diferencias: [] });
  });

  it("la fachada no agrega lecturas: mismas etapas, mismo orden", async () => {
    entender.mockImplementation(async () => ({ plan: planConCategoria("panel de interior"), msJev: null, jevFallo: false, consultaNorm: "x" }));
    const etapas = async (ejecutar: unknown) => {
      lecturas.length = 0;
      await (ejecutar as typeof ejecutarMotor)("panel de interior", { ...ctxBase, superficie, politica: "legado" });
      return [...lecturas];
    };
    expect(await etapas(ejecutarMotor)).toEqual(await etapas(ejecutarLegado));
  });
});

describe("ejecutarMotor: lo que informa", () => {
  it("catálogo con plan en la URL: duros, etapa e ids", async () => {
    entender.mockImplementation(async (q: string) => ({ plan: planConCategoria(q), msJev: null, jevFallo: false, consultaNorm: q }));
    tabla.plan = ["a", "b"];
    const r = await ejecutarMotor("panel de interior", { ...ctxBase, superficie: "catalogo", politica: "legado" });
    expect(r).toMatchObject({ etapa: "plan", ids: ["a", "b"], total: 2, intencion: "producto", categoriasDuras: ["Paneles"] });
  });

  it("autocompletar y chat no aplican los duros del plan (como en producción)", async () => {
    entender.mockImplementation(async (q: string) => ({ plan: planConCategoria(q), msJev: null, jevFallo: false, consultaNorm: q }));
    tabla.plan = ["a"];
    tabla.exacta = ["a"];
    const r = await ejecutarMotor("panel de interior", { ...ctxBase, superficie: "autocompletar", politica: "legado" });
    expect(r).toMatchObject({ etapa: "plan", categoriasDuras: [], categoriasBlandas: ["Paneles"] });
    const chat = await ejecutarMotor("panel de interior", { ...ctxBase, superficie: "chat", politica: "legado" });
    expect(chat).toMatchObject({ etapa: "exacta", intencion: undefined });
    // El chat legado nunca pide plan: Entender no se llamó para él.
    expect(entender).toHaveBeenCalledTimes(1);
  });

  it("la política cascada, todavía sin implementar, falla con un mensaje claro", async () => {
    await expect(ejecutarMotor("panel", { ...ctxBase, superficie: "chat", politica: "cascada" })).rejects.toThrow(/cascada/);
  });

  it("respeta el K de la superficie como límite de lectura", async () => {
    tabla.exacta = Array.from({ length: 40 }, (_, i) => `p${i}`);
    entender.mockImplementation(async (q: string) => ({ plan: planSinAporte(q), msJev: null, jevFallo: false, consultaNorm: q }));
    for (const s of ["catalogo", "autocompletar", "chat"] as const) {
      const r = await ejecutarMotor("panel led", { ...ctxBase, superficie: s, politica: "legado" });
      expect(r.productos).toHaveLength(SUPERFICIES_BANCO[s].k);
    }
  });
});

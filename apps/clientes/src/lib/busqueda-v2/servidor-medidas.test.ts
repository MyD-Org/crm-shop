import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las medidas en `servidor.obtener` (flag `busqueda-medidas`): se mergean al plan DESPUÉS de la caché,
 * se calculan sobre la consulta CRUDA, no se guardan, y con el flag apagado todo queda como antes.
 */
const guardarPlan = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const leerPlan = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
const contarCatalogo = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 50);
const flag = vi.fn(async () => false);
const atributosEstructurados = vi.fn(async () => true);

vi.mock("../catalog", () => ({
  getArbolCategorias: async () => [
    { id: "i", parentId: null, nombre: "ILUMINACION", orden: 1 },
    { id: "e", parentId: null, nombre: "ELECTRICIDAD", orden: 2 },
  ],
  contarCatalogo: (...a: unknown[]) => contarCatalogo(...a),
}));
vi.mock("../catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: () => atributosEstructurados() }));
vi.mock("../busqueda-medidas-flag", () => ({ busquedaMedidasHabilitada: () => flag() }));
vi.mock("../busqueda-inteligente/jev", async (original) => ({
  ...(await original<typeof import("../busqueda-inteligente/jev")>()),
  consultarJev: async () => null,
}));
vi.mock("./cache", async (original) => {
  const real = await original<typeof import("./cache")>();
  return { ...real, guardarPlan: (...a: unknown[]) => guardarPlan(...a), leerPlan: (...a: unknown[]) => leerPlan(...a), lru: new real.Lru(10, 60_000) };
});

import type { PlanBusqueda } from "./plan";
import { claveLru, lru } from "./cache";
import { clavePlan, planParaBuscar, planParaPagina, reiniciarMemoMedidas } from "./servidor";

const ARBOL = [
  { id: "i", parentId: null, nombre: "ILUMINACION", orden: 1 },
  { id: "e", parentId: null, nombre: "ELECTRICIDAD", orden: 2 },
];

const opciones = { soloVisibles: false };

/** Un plan "guardado" en la base: sin medidas, como los de antes de este cambio. */
function guardado(consulta: string, duros: string[] = []): PlanBusqueda {
  return {
    version: 1,
    consulta,
    intencion: "producto",
    duros: { categorias: [], atributos: duros },
    blandos: { categorias: [], atributos: [], terminos: [{ texto: "termica", peso: 1 }, { texto: "2x20", peso: 0.4 }] },
    fuente: "cache",
  };
}

const hayMedida = (p: PlanBusqueda | null | undefined) => !!p && [...p.duros.atributos, ...p.blandos.atributos.map((a) => a.id)].some((id) => /^[a-z_]+:/.test(id));

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.stubEnv("JEV_API_KEY", "");
  guardarPlan.mockClear();
  leerPlan.mockReset();
  leerPlan.mockResolvedValue(null);
  contarCatalogo.mockReset();
  contarCatalogo.mockResolvedValue(50);
  flag.mockReset();
  flag.mockResolvedValue(false);
  atributosEstructurados.mockReset();
  atributosEstructurados.mockResolvedValue(true);
  reiniciarMemoMedidas();
});

describe("flag apagado: comportamiento de siempre", () => {
  it("el plan no trae medidas ni se cuentan (camino fresco)", async () => {
    const plan = await planParaPagina("termica 2x20", opciones);
    expect(plan).toBeTruthy();
    expect(hayMedida(plan)).toBe(false);
    expect(plan?.duros.atributos).toEqual([]);
  });

  it("el plan de la caché sale tal cual", async () => {
    const base = guardado("termica 2x20");
    leerPlan.mockResolvedValue(base);
    const plan = await planParaPagina("termica 2x20", opciones);
    expect(plan).toEqual({ ...base, fuente: "cache" });
  });

  it("no se hace ningún conteo de medidas (cobertura/positivo)", async () => {
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    await planParaPagina("termica 2x20", opciones);
    expect(contarCatalogo).not.toHaveBeenCalled();
  });

  it("un flag que lanza se comporta como apagado", async () => {
    flag.mockRejectedValue(new Error("sin red"));
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    const plan = await planParaPagina("termica 2x20", opciones);
    expect(hayMedida(plan)).toBe(false);
  });
});

describe("flag prendido", () => {
  beforeEach(() => flag.mockResolvedValue(true));

  it("camino fresco (Entender determinista): termica 2x20 suma polos y corriente duros", async () => {
    const plan = await planParaPagina("termica 2x20", opciones);
    expect(plan?.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    expect(plan?.blandos.atributos).toEqual(expect.arrayContaining([{ id: "polos:2", peso: 1 }, { id: "corriente_a:20", peso: 1 }]));
  });

  it("cache en base: el plan viejo (sin medidas) también las trae y la fila NO se toca", async () => {
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    const plan = await planParaPagina("termica 2x20", opciones);
    expect(plan?.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    expect(plan?.fuente).toBe("cache");
    expect(guardarPlan).not.toHaveBeenCalled();
  });

  it("cache en memoria: después de /buscar, la página también las trae", async () => {
    const buscado = await planParaBuscar("termica 2x20", { ...opciones, ip: "1.2.3.4" });
    expect(buscado?.plan.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    const enPagina = await planParaPagina("termica 2x20", opciones);
    expect(enPagina?.fuente).toBe("cache");
    expect(enPagina?.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
  });

  it("lo que se guarda en la caché (base y memoria) NO lleva medidas", async () => {
    await planParaBuscar("termica 2x16", { ...opciones, ip: "1.2.3.4" });
    expect(guardarPlan).toHaveBeenCalledTimes(1);
    const guardadoEnBase = guardarPlan.mock.calls[0][3] as PlanBusqueda;
    expect(hayMedida(guardadoEnBase)).toBe(false);
    expect(guardadoEnBase.duros.atributos).toEqual([]);
    // Ni en la memoria de planes: la página que lee de ahí recalcula las medidas, no las hereda guardadas.
    const enMemoria = lru.get(claveLru("tenant-test", clavePlan(ARBOL, false), "termica 2x16"));
    expect(hayMedida(enMemoria?.plan)).toBe(false);
  });

  it("'lampara 9,5w' y 'lampara 9 5w' comparten fila de caché pero cada una lee SU valor", async () => {
    const base = guardado("lampara 9 5w");
    leerPlan.mockResolvedValue(base);
    const a = await planParaPagina("lampara 9,5w", opciones);
    const b = await planParaPagina("lampara 9 5w", opciones);
    const ids = (p: PlanBusqueda | null) => p?.blandos.atributos.map((x) => x.id) ?? [];
    expect(ids(a)).toEqual(expect.arrayContaining(["potencia_w:9.5"]));
    expect(ids(a)).not.toContain("potencia_w:5");
    expect(ids(b)).toEqual(expect.arrayContaining(["potencia_w:5"]));
    expect(ids(b)).not.toContain("potencia_w:9.5");
    expect(guardarPlan).not.toHaveBeenCalled();
  });

  it("apagar y prender el flag se nota en la request siguiente (el memo no congela el flag)", async () => {
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    const prendido = await planParaPagina("termica 2x20", opciones);
    expect(hayMedida(prendido)).toBe(true);
    flag.mockResolvedValue(false);
    expect(hayMedida(await planParaPagina("termica 2x20", opciones))).toBe(false);
    flag.mockResolvedValue(true);
    expect(hayMedida(await planParaPagina("termica 2x20", opciones))).toBe(true);
  });

  it("el memo evita contar de nuevo para la misma consulta y el mismo plan", async () => {
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    await planParaPagina("termica 2x20", opciones);
    const llamadas = contarCatalogo.mock.calls.length;
    expect(llamadas).toBeGreaterThan(0);
    const otra = await planParaPagina("termica 2x20", opciones);
    expect(contarCatalogo.mock.calls.length).toBe(llamadas);
    expect(otra?.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
  });

  it("planes base distintos para la misma consulta no se pisan en el memo", async () => {
    leerPlan.mockResolvedValue(guardado("termica 2x32", []));
    const a = await planParaPagina("termica 2x32", opciones);
    leerPlan.mockResolvedValue(guardado("termica 2x32", ["tono-calido"]));
    // Otro plan base para la misma consulta (la memoria de planes lo reemplaza, p. ej. por un /buscar con Jev).
    lru.set(claveLru("tenant-test", clavePlan(ARBOL, false), "termica 2x32"), { plan: guardado("termica 2x32", ["tono-calido"]) });
    const b = await planParaPagina("termica 2x32", opciones);
    expect(a?.duros.atributos).toEqual(["polos:2", "corriente_a:32"]);
    expect(b?.duros.atributos).toEqual(["tono-calido", "polos:2", "corriente_a:32"]);
  });

  it("el memo guarda la decisión, no el plan: la consulta cruda de cada visitante se respeta", async () => {
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    const a = await planParaPagina("Termica 2x20", opciones);
    expect(a?.consulta).toBe("Termica 2x20");
    const b = await planParaPagina("termica 2x20", opciones);
    expect(b?.consulta).toBe("termica 2x20");
  });

  it("sin atributos estructurados: sin duros", async () => {
    atributosEstructurados.mockResolvedValue(false);
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    const plan = await planParaPagina("termica 2x20", opciones);
    expect(plan?.duros.atributos).toEqual([]);
    expect(plan?.blandos.atributos.map((a) => a.id)).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
  });

  it("un error al aplicar las medidas no rompe la búsqueda: sale el plan sin medidas y no se memoiza", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    contarCatalogo.mockRejectedValue(new RangeError("la base no responde: termica 2x20"));
    const plan = await planParaPagina("termica 2x20", opciones);
    expect(plan).toBeTruthy();
    expect(hayMedida(plan)).toBe(false);
    const avisos = aviso.mock.calls.map(String).join("\n");
    expect(avisos).toContain("RangeError");
    expect(avisos).not.toContain("termica");
    // Se recupera sola en la request siguiente.
    contarCatalogo.mockResolvedValue(50);
    expect(hayMedida(await planParaPagina("termica 2x20", opciones))).toBe(true);
    aviso.mockRestore();
  });

  it("una consulta que es un código no recibe medidas", async () => {
    const plan = await planParaPagina("DL-18W", opciones);
    expect(hayMedida(plan)).toBe(false);
  });

  it("las medidas se calculan sobre el catálogo entero, como la decisión duro/blando del plan", async () => {
    leerPlan.mockResolvedValue(guardado("termica 2x20"));
    await planParaPagina("termica 2x20", opciones);
    for (const [arg] of contarCatalogo.mock.calls) {
      const a = arg as { filtros: { soloStock: boolean }; soloVisibles: boolean };
      expect(a.filtros.soloStock).toBe(false);
    }
    const positivos = contarCatalogo.mock.calls.filter(([a]) => (a as { filtros: { medidasPositivas?: boolean } }).filtros.medidasPositivas);
    expect(positivos.length).toBeGreaterThan(0);
    const cobertura = contarCatalogo.mock.calls.filter(([a]) => (a as { filtros: { conClaves?: string[] } }).filtros.conClaves);
    expect(cobertura.length).toBeGreaterThan(0);
  });
});

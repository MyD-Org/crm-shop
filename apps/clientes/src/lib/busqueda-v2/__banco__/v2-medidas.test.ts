/**
 * `obtenerPlan` / `ejecutarV2` con `--medidas=si|no`: el banco aplica `aplicarMedidas` en el único punto
 * donde adquiere el plan (camino fresco, `planDe` = --jev=cache y --produccion), y con `no` reproduce
 * exactamente la tubería de antes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPaginaCatalogo = vi.fn();
const entender = vi.fn();
const contar = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 50);
const contador = vi.fn<(...args: unknown[]) => typeof contar>(() => contar);
vi.mock("@/lib/catalog", () => ({ getPaginaCatalogo: (...a: unknown[]) => getPaginaCatalogo(...a) }));
vi.mock("../entender/entender", () => ({ entender: (...a: unknown[]) => entender(...a) }));
vi.mock("../conteo", () => ({ contador: (...a: unknown[]) => contador(...a) }));

import { planVacio, type PlanBusqueda } from "../plan";
import { ejecutarV2, obtenerPlan } from "./v2";
import { vistaProduccion } from "./vista";

const base = (q: string): PlanBusqueda => ({
  ...planVacio(q),
  blandos: { categorias: [], atributos: [], terminos: [{ texto: "termica", peso: 1 }, { texto: "2x20", peso: 0.4 }] },
});
const pagina = { productos: [{ name: "p0" }], total: 1, pagina: 1, paginas: 1 };

beforeEach(() => {
  getPaginaCatalogo.mockReset();
  getPaginaCatalogo.mockResolvedValue(pagina);
  entender.mockReset();
  entender.mockImplementation(async (q: string) => ({ plan: base(q), msJev: null, jevFallo: false, consultaNorm: q }));
  contar.mockClear();
  contador.mockClear();
});

const ctx = { arbol: [], jev: null, estructurados: true };

describe("obtenerPlan con medidas", () => {
  it("sin `medidas` (o false): igual que antes, sin ids y sin contadores de medidas", async () => {
    const r = await obtenerPlan("termica 2x20", ctx);
    expect(r).toEqual({ plan: base("termica 2x20"), sinPlanCacheado: false });
    expect(contador).toHaveBeenCalledTimes(1);
    expect(await obtenerPlan("termica 2x20", { ...ctx, medidas: false })).toEqual(r);
  });

  it("con medidas: el plan trae polos y corriente duros y devuelve los ids", async () => {
    const r = await obtenerPlan("termica 2x20", { ...ctx, medidas: true });
    expect(r.plan?.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    expect(r.medidas).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
    expect(r.sinPlanCacheado).toBe(false);
  });

  it("usa los mismos contadores que el servidor: catálogo entero y, aparte, el positivo", async () => {
    await obtenerPlan("termica 2x20", { ...ctx, medidas: true });
    expect(contador).toHaveBeenCalledWith({ soloVisibles: false, soloStock: false, estructurados: true });
    expect(contador).toHaveBeenCalledWith({ soloVisibles: false, soloStock: false, estructurados: true, positivos: true });
  });

  it("--produccion: el contador respeta soloVisibles de la vista", async () => {
    await obtenerPlan("termica 2x20", { ...ctx, medidas: true, vista: vistaProduccion(true) });
    expect(contador).toHaveBeenCalledWith({ soloVisibles: true, soloStock: false, estructurados: true, positivos: true });
  });

  it("--jev=cache: el plan cacheado (sin medidas) también las recibe", async () => {
    const cacheado = { ...base("termica 2x20"), fuente: "cache" as const };
    const r = await obtenerPlan("termica 2x20", { ...ctx, medidas: true, planDe: async () => cacheado });
    expect(entender).not.toHaveBeenCalled();
    expect(r.plan?.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
    expect(r.plan?.fuente).toBe("cache");
  });

  it("--jev=cache sin plan cacheado: Entender determinista + medidas, y lo marca", async () => {
    const r = await obtenerPlan("termica 2x20", { ...ctx, medidas: true, planDe: async () => null });
    expect(r.sinPlanCacheado).toBe(true);
    expect(r.plan?.duros.atributos).toEqual(["polos:2", "corriente_a:20"]);
  });

  it("lee la consulta cruda: '9,5w'", async () => {
    entender.mockImplementation(async (q: string) => ({ plan: { ...planVacio(q), blandos: { categorias: [], atributos: [], terminos: [{ texto: "lampara", peso: 1 }] } }, msJev: null, jevFallo: false, consultaNorm: q }));
    const r = await obtenerPlan("lampara 9,5w", { ...ctx, medidas: true });
    expect(r.medidas).toEqual(expect.arrayContaining(["potencia_w:9.5"]));
  });

  it("si Entender no arma un plan: plan null y sin ids", async () => {
    entender.mockResolvedValue(null);
    expect(await obtenerPlan("termica 2x20", { ...ctx, medidas: true })).toEqual({ plan: null, sinPlanCacheado: false });
  });

  it("un plan de código: sin medidas, con la lista vacía (la tubería las produce y no hubo ninguna)", async () => {
    entender.mockResolvedValue({ plan: planVacio("20a", "codigo"), msJev: null, jevFallo: false, consultaNorm: "20a" });
    const r = await obtenerPlan("20a", { ...ctx, medidas: true });
    expect(r.medidas).toEqual([]);
    expect(r.plan?.duros.atributos).toEqual([]);
  });

  it("un error de los conteos no rompe: plan sin medidas", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    contar.mockRejectedValue(new Error("base caída"));
    const r = await obtenerPlan("termica 2x20", { ...ctx, medidas: true });
    expect(r.plan).toEqual(base("termica 2x20"));
    aviso.mockRestore();
    contar.mockResolvedValue(50);
  });
});

describe("ejecutarV2 con medidas", () => {
  it("rellena ResultadoBanco.medidas y manda los duros a la página", async () => {
    const r = await ejecutarV2("termica 2x20", { ...ctx, medidas: true });
    expect(r.atributosDuros).toEqual(["polos:2", "corriente_a:20"]);
    expect(r.medidas).toEqual(expect.arrayContaining(["polos:2", "corriente_a:20"]));
    const filtros = getPaginaCatalogo.mock.calls[0][0].filtros;
    // `estadoConPlan` los ordena (atributosValidos: orden de las claves de medida).
    expect([...filtros.atributos].sort()).toEqual(["corriente_a:20", "polos:2"]);
    expect(filtros.texto.plan.blandos.atributos).toEqual(expect.arrayContaining([{ id: "polos:2", peso: 1 }]));
  });

  it("sin `medidas`: ResultadoBanco no trae `medidas` (la tubería no las produce: hit = null)", async () => {
    const r = await ejecutarV2("termica 2x20", ctx);
    expect("medidas" in r).toBe(false);
    expect(r.atributosDuros).toEqual([]);
  });

  it("un plan de código con medidas: medidas = [] (negativo evaluable)", async () => {
    entender.mockResolvedValue({ plan: planVacio("DL-18W", "codigo"), msJev: null, jevFallo: false, consultaNorm: "dl-18w" });
    const r = await ejecutarV2("DL-18W", { ...ctx, medidas: true });
    expect(r.medidas).toEqual([]);
  });
});

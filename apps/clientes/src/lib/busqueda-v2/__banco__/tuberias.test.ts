/**
 * fase1 y v2 con la `vista` nueva: sin ella (default VISTA_ACTUAL) se comportan
 * exactamente como antes del cambio (soloVisibles false, stock = todos); con
 * `vistaProduccion` pasan lo que ve el cliente. v2 con `planDe` (--jev=cache).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPaginaCatalogo = vi.fn();
const entender = vi.fn();
const contador = vi.fn();
vi.mock("@/lib/catalog", () => ({ getPaginaCatalogo: (...a: unknown[]) => getPaginaCatalogo(...a) }));
vi.mock("../entender/entender", () => ({ entender: (...a: unknown[]) => entender(...a) }));
vi.mock("../conteo", () => ({ contador: (...a: unknown[]) => contador(...a) }));

import { planVacio } from "../plan";
import { ejecutarFase1 } from "./fase1";
import { ejecutarV2 } from "./v2";
import { vistaProduccion } from "./vista";

const pagina = (n: number) => ({ productos: Array.from({ length: n }, (_, i) => ({ name: `p${i}` })), total: n, pagina: 1, paginas: 1 });
const entendido = (q: string) => ({ plan: planVacio(q), msJev: null, jevFallo: false, consultaNorm: q });

beforeEach(() => {
  for (const m of [getPaginaCatalogo, entender, contador]) m.mockReset();
  getPaginaCatalogo.mockResolvedValue(pagina(3));
  entender.mockImplementation(async (q: string) => entendido(q));
});

describe("fase1", () => {
  const ctx = { arbol: [], jev: null, estructurados: false };

  it("sin vista: soloVisibles false y stock = todos (comportamiento previo)", async () => {
    await ejecutarFase1("DL-18W", ctx);
    const opts = getPaginaCatalogo.mock.calls[0][0];
    expect(opts.soloVisibles).toBe(false);
    expect(opts.filtros.soloStock).toBe(false);
    expect(opts.filtros.busqueda).toBe("DL-18W");
  });

  it("con vistaProduccion(true): soloVisibles y stock por defecto", async () => {
    await ejecutarFase1("DL-18W", { ...ctx, vista: vistaProduccion(true) });
    const opts = getPaginaCatalogo.mock.calls[0][0];
    expect(opts.soloVisibles).toBe(true);
    expect(opts.filtros.soloStock).toBe(true);
  });
});

describe("v2", () => {
  const ctx = { arbol: [], jev: null, estructurados: true };

  it("sin vista: el contador y la página usan soloVisibles false y stock = todos", async () => {
    await ejecutarV2("lampara", ctx);
    expect(contador).toHaveBeenCalledWith({ soloVisibles: false, soloStock: false, estructurados: true });
    const opts = getPaginaCatalogo.mock.calls[0][0];
    expect(opts.soloVisibles).toBe(false);
    expect(opts.filtros.soloStock).toBe(false);
    expect(opts.filtros.atributosEstructurados).toBe(true);
  });

  it("vistaProduccion(true): el contador de Entender sigue sin filtrar stock (como el servidor) pero con soloVisibles", async () => {
    await ejecutarV2("lampara", { ...ctx, vista: vistaProduccion(true) });
    expect(contador).toHaveBeenCalledWith({ soloVisibles: true, soloStock: false, estructurados: true });
    const opts = getPaginaCatalogo.mock.calls[0][0];
    expect(opts.soloVisibles).toBe(true);
    expect(opts.filtros.soloStock).toBe(true);
  });

  it("planDe con plan cacheado: no llama a Entender ni cuenta faltantes", async () => {
    const plan = { ...planVacio("lampara"), fuente: "cache" as const };
    const planDe = vi.fn().mockResolvedValue(plan);
    const r = await ejecutarV2("lampara", { ...ctx, planDe });
    expect(planDe).toHaveBeenCalledWith("lampara");
    expect(entender).not.toHaveBeenCalled();
    expect(r.sinPlanCacheado).toBeUndefined();
    expect(r.intencion).toBe("producto");
  });

  it("planDe sin plan cacheado: cae a Entender determinista y lo marca", async () => {
    const planDe = vi.fn().mockResolvedValue(null);
    const r = await ejecutarV2("lampara", { ...ctx, planDe });
    expect(entender).toHaveBeenCalledTimes(1);
    expect(entender.mock.calls[0][1].jev).toBeNull();
    expect(r.sinPlanCacheado).toBe(true);
  });

  it("un plan de código va por la búsqueda clásica de la página", async () => {
    entender.mockResolvedValue({ ...entendido("DL-18W"), plan: planVacio("DL-18W", "codigo") });
    const r = await ejecutarV2("DL-18W", ctx);
    expect(r.intencion).toBe("codigo");
    expect(getPaginaCatalogo.mock.calls[0][0].filtros.planBusqueda).toBeUndefined();
  });
});

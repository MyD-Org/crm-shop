import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";
import type { Facetas, FiltrosCatalogo, PaginaCatalogo } from "../catalog";
import { pareceCodigo } from "../busqueda-inteligente/gate";
import { PRESUPUESTOS_CASCADA, buscar, etapasDe, necesitaPlan, sinTexto, type DepsMotor, type OpcionesBuscar, type PedidoBuscar } from "./motor";
import { criterioDe } from "./destino";
import { planVacio, type PlanBusqueda } from "./plan";

/** Códigos y consultas inequívocos (no dependen de los tokens frontera de `pareceCodigo`). */
const CODIGO = "DL-18W";
const CONSULTA = "panel led";

const prod = (id: string) => ({ id, name: id }) as unknown as Product;

type ArgsPagina = Parameters<DepsMotor["pagina"]>[0];

/** Deps falsas: `cuantos` dice cuántos productos devuelve cada lectura (o lanza un Error). */
function crearDeps(cuantos: (a: ArgsPagina, n: number) => number | Error = () => 0) {
  const llamadas: ArgsPagina[] = [];
  const facetas: FiltrosCatalogo[] = [];
  const deps: DepsMotor = {
    pagina: async (a) => {
      llamadas.push(a);
      const r = cuantos(a, llamadas.length);
      if (r instanceof Error) throw r;
      const total = r;
      return {
        productos: Array.from({ length: total }, (_, i) => prod(`p${i}`)),
        total,
        pagina: a.sinConteo ? 1 : a.pagina,
        paginas: a.sinConteo ? 1 : Math.max(Math.ceil(total / a.porPagina), 1),
        totalExacto: !a.sinConteo,
      } satisfies PaginaCatalogo;
    },
    facetas: async (f) => {
      facetas.push(f);
      return { categorias: [], marcas: [], atributos: [], precio: null } as unknown as Facetas;
    },
    log: vi.fn(),
  };
  return { deps, llamadas, facetas };
}

const pedido = (extra: Partial<PedidoBuscar> = {}): PedidoBuscar => ({
  consulta: CONSULTA,
  filtros: {},
  orden: "relevancia",
  pagina: 1,
  porPagina: 24,
  ...extra,
});

const planProducto = (extra: Partial<PlanBusqueda> = {}): PlanBusqueda => ({
  ...planVacio(CONSULTA),
  blandos: { categorias: [{ nombre: "Paneles", peso: 0.9 }], atributos: [], terminos: [{ texto: "panel", peso: 1 }] },
  ...extra,
});

const legado = (superficie: OpcionesBuscar["superficie"], extra: Partial<OpcionesBuscar> = {}): OpcionesBuscar => ({
  superficie,
  politica: "legado",
  conPlan: true,
  ...extra,
});

const etapas = (a: Partial<Parameters<typeof etapasDe>[0]>) =>
  etapasDe({ politica: "legado", superficie: "catalogo", consulta: CONSULTA, plan: null, conPlan: true, ...a });

describe("sinTexto", () => {
  it("omite los campos de texto y conserva el resto", () => {
    const f: FiltrosCatalogo = {
      texto: { q: "a" },
      busqueda: "a",
      busquedaTolerante: true,
      planBusqueda: { consulta: "a", blandos: { categorias: [], atributos: [], terminos: [] } },
      categorias: ["Lámparas"],
      marcas: ["Marca X"],
      atributos: ["tono-calido"],
      precioMin: 10,
      potenciaMax: 50,
      soloStock: true,
      atributosEstructurados: true,
    };
    expect(sinTexto(f)).toEqual({
      categorias: ["Lámparas"],
      marcas: ["Marca X"],
      atributos: ["tono-calido"],
      precioMin: 10,
      potenciaMax: 50,
      soloStock: true,
      atributosEstructurados: true,
    });
  });
});

describe("etapasDe: política legado (reproduce las secuencias de hoy)", () => {
  it("precondición: el código de los fixtures lo es", () => {
    expect(pareceCodigo(CODIGO)).toBe(true);
    expect(pareceCodigo(CONSULTA)).toBe(false);
  });

  it("catálogo: con plan usable, sólo el plan (la tolerante no corre con plan)", () => {
    expect(etapas({ plan: planProducto() })).toEqual(["plan"]);
  });

  it("catálogo: un plan de intención código cuenta como sin plan", () => {
    expect(etapas({ plan: planProducto({ intencion: "codigo" }) })).toEqual(["exacta", "tolerante"]);
  });

  it("catálogo: sin plan o con conPlan apagado, exacta y tolerante", () => {
    expect(etapas({})).toEqual(["exacta", "tolerante"]);
    expect(etapas({ plan: planProducto(), conPlan: false })).toEqual(["exacta", "tolerante"]);
  });

  it("autocompletar: plan, exacta, tolerante (el plan sólo si la consulta no parece un código)", () => {
    expect(etapas({ superficie: "autocompletar", plan: planProducto() })).toEqual(["plan", "exacta", "tolerante"]);
    expect(etapas({ superficie: "autocompletar", plan: planProducto(), consulta: CODIGO })).toEqual(["exacta", "tolerante"]);
    expect(etapas({ superficie: "autocompletar", plan: planProducto({ intencion: "codigo" }) })).toEqual(["exacta", "tolerante"]);
    expect(etapas({ superficie: "autocompletar" })).toEqual(["exacta", "tolerante"]);
    expect(etapas({ superficie: "autocompletar", plan: planProducto(), conPlan: false })).toEqual(["exacta", "tolerante"]);
  });

  it("chat: exacta y tolerante, nunca plan", () => {
    expect(etapas({ superficie: "chat", plan: planProducto() })).toEqual(["exacta", "tolerante"]);
  });

  it("admin: sólo exacta", () => {
    expect(etapas({ superficie: "admin", plan: planProducto() })).toEqual(["exacta"]);
  });

  it("sin texto o sin términos tras terminosBusqueda: una lectura sin texto", () => {
    for (const consulta of ["", "   ", "!!!", "- ."]) {
      for (const superficie of ["catalogo", "autocompletar", "chat", "admin"] as const) {
        expect(etapas({ consulta, superficie, plan: planProducto() })).toEqual(["sin-texto"]);
      }
    }
  });

  it("la tolerante se omite si ningún término tiene 4 letras o más", () => {
    expect(etapas({ consulta: "9w" })).toEqual(["exacta"]);
    expect(etapas({ consulta: "9w e27", superficie: "chat" })).toEqual(["exacta"]);
    expect(etapas({ consulta: "9w lampara", superficie: "chat" })).toEqual(["exacta", "tolerante"]);
  });

  it("conPlan=false nunca produce `plan`", () => {
    for (const superficie of ["catalogo", "autocompletar", "chat", "admin"] as const) {
      expect(etapas({ superficie, plan: planProducto(), conPlan: false })).not.toContain("plan");
    }
  });
});

describe("necesitaPlan: el plan es perezoso", () => {
  const n = (a: Partial<Parameters<typeof necesitaPlan>[0]>) =>
    necesitaPlan({ politica: "legado", superficie: "catalogo", consulta: CONSULTA, conPlan: true, ...a });

  it("sólo catálogo y autocompletar lo piden, y sólo con texto y conPlan", () => {
    expect(n({})).toBe(true);
    expect(n({ superficie: "autocompletar" })).toBe(true);
    expect(n({ superficie: "chat" })).toBe(false);
    expect(n({ superficie: "admin" })).toBe(false);
    expect(n({ conPlan: false })).toBe(false);
    expect(n({ consulta: "" })).toBe(false);
    expect(n({ consulta: "!!!" })).toBe(false);
  });

  it("autocompletar no lo pide para algo que parece un código", () => {
    expect(n({ superficie: "autocompletar", consulta: CODIGO })).toBe(false);
  });
});

describe("buscar: caracterización de los argumentos que cada superficie le pasa hoy a la lectura", () => {
  it("catálogo sin plan: exacta con conteo, la página pedida y los filtros tal cual", async () => {
    const { deps, llamadas } = crearDeps(() => 3);
    const filtros = { categorias: ["Lámparas"], marcas: ["Marca X"], soloStock: true, atributosEstructurados: true };
    const r = await buscar(pedido({ filtros, pagina: 2, porPagina: 24, orden: "precio-asc" }), legado("catalogo"), deps);
    expect(llamadas).toEqual([
      { filtros: { ...filtros, texto: { q: CONSULTA } }, orden: "precio-asc", pagina: 2, porPagina: 24, sinConteo: false },
    ]);
    expect(r).toMatchObject({ etapa: "exacta", total: 3, intentos: ["exacta"], totalExacto: true });
    expect(r.productos).toHaveLength(3);
  });

  it("catálogo: con plan, `texto.plan` es el criterio del plan menos lo que ya es filtro duro", async () => {
    const plan = planProducto({
      blandos: {
        categorias: [{ nombre: "Paneles", peso: 0.9 }, { nombre: "Lámparas", peso: 0.8 }],
        atributos: [{ id: "tono-calido", peso: 1 }],
        terminos: [{ texto: "panel", peso: 1 }],
      },
    });
    const { deps, llamadas } = crearDeps(() => 5);
    const filtros = { categorias: ["Lámparas"] };
    const r = await buscar(pedido({ filtros }), legado("catalogo", { planDe: async () => plan }), deps);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].filtros.texto).toEqual({ q: CONSULTA, plan: criterioDe(plan, { categorias: ["Lámparas"], atributos: [] }) });
    expect(llamadas[0].filtros.categorias).toEqual(["Lámparas"]);
    expect(r.etapa).toBe("plan");
    expect(r.plan).toBe(plan);
  });

  it("catálogo: plan con 0 resultados => vacío, SIN reintento tolerante (como hoy)", async () => {
    const { deps, llamadas } = crearDeps(() => 0);
    const r = await buscar(pedido(), legado("catalogo", { planDe: async () => planProducto() }), deps);
    expect(llamadas).toHaveLength(1);
    expect(r).toMatchObject({ etapa: "vacio", total: 0, productos: [], intentos: ["plan"] });
  });

  it("catálogo: exacta 0 => tolerante (sin plan, con los mismos filtros y página)", async () => {
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 2 : 0));
    const r = await buscar(pedido({ pagina: 3, filtros: { marcas: ["Marca X"] } }), legado("catalogo"), deps);
    expect(llamadas.map((l) => l.filtros.texto)).toEqual([{ q: CONSULTA }, { q: CONSULTA, tolerante: true }]);
    expect(llamadas[1]).toMatchObject({ pagina: 3, orden: "relevancia", porPagina: 24, sinConteo: false });
    expect(r).toMatchObject({ etapa: "tolerante", total: 2, intentos: ["exacta", "tolerante"] });
    expect(r.filtrosEfectivos.texto).toEqual({ q: CONSULTA, tolerante: true });
    expect(r.filtrosEfectivos.marcas).toEqual(["Marca X"]);
  });

  it("autocompletar: plan => exacta => tolerante, sin conteo, porPagina = límite, estructurados sólo en el plan", async () => {
    const { deps, llamadas } = crearDeps(() => 0);
    const r = await buscar(
      pedido({ porPagina: 8, filtros: { atributosEstructurados: true } }),
      legado("autocompletar", { planDe: async () => planProducto() }),
      deps,
    );
    expect(llamadas.map((l) => Object.keys(l.filtros.texto ?? {}).sort())).toEqual([["plan", "q"], ["q"], ["q", "tolerante"]]);
    expect(llamadas.every((l) => l.sinConteo && l.porPagina === 8 && l.pagina === 1)).toBe(true);
    expect(llamadas.map((l) => l.filtros.atributosEstructurados)).toEqual([true, undefined, undefined]);
    expect(r).toMatchObject({ etapa: "vacio", intentos: ["plan", "exacta", "tolerante"], totalExacto: false });
  });

  it("autocompletar: sale en la primera etapa con resultados (salida temprana)", async () => {
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.plan ? 4 : 9));
    const r = await buscar(pedido({ porPagina: 8 }), legado("autocompletar", { planDe: async () => planProducto() }), deps);
    expect(llamadas).toHaveLength(1);
    expect(r).toMatchObject({ etapa: "plan", total: 4 });
  });

  it("chat: exacta => tolerante, estructurados siempre, el plan no se consulta aunque haya planDe", async () => {
    const planDe = vi.fn(async () => planProducto());
    const { deps, llamadas } = crearDeps(() => 0);
    const r = await buscar(pedido({ porPagina: 10, filtros: { atributosEstructurados: true } }), legado("chat", { planDe }), deps);
    expect(planDe).not.toHaveBeenCalled();
    expect(llamadas.map((l) => l.filtros.texto)).toEqual([{ q: CONSULTA }, { q: CONSULTA, tolerante: true }]);
    expect(llamadas.every((l) => l.filtros.atributosEstructurados === true && l.sinConteo && l.porPagina === 10)).toBe(true);
    expect(r.etapa).toBe("vacio");
  });

  it("admin: una sola lectura exacta", async () => {
    const planDe = vi.fn(async () => planProducto());
    const { deps, llamadas } = crearDeps(() => 0);
    const r = await buscar(pedido({ porPagina: 20 }), legado("admin", { planDe }), deps);
    expect(planDe).not.toHaveBeenCalled();
    expect(llamadas).toHaveLength(1);
    expect(r).toMatchObject({ etapa: "vacio", intentos: ["exacta"] });
  });

  it("`conteo` se puede forzar y la página sólo vale con conteo", async () => {
    const { deps, llamadas } = crearDeps(() => 1);
    await buscar(pedido({ pagina: 4 }), legado("chat", { conteo: true }), deps);
    await buscar(pedido({ pagina: 4 }), legado("catalogo", { conteo: false }), deps);
    expect(llamadas.map((l) => [l.sinConteo, l.pagina])).toEqual([[false, 4], [true, 1]]);
  });

  it("una exacta con resultados corta ahí: la tolerante no corre", async () => {
    const { deps, llamadas } = crearDeps(() => 1);
    await buscar(pedido(), legado("chat"), deps);
    expect(llamadas).toHaveLength(1);
  });
});

describe("buscar: el plan", () => {
  it("planDe recibe la consulta CRUDA (sólo trim), nunca una normalizada", async () => {
    const planDe = vi.fn(async () => null);
    const { deps } = crearDeps(() => 1);
    await buscar(pedido({ consulta: "  bipolar 9,5w " }), legado("catalogo", { planDe }), deps);
    expect(planDe).toHaveBeenCalledTimes(1);
    expect(planDe).toHaveBeenCalledWith("bipolar 9,5w");
  });

  it("una consulta sin términos hace una lectura sin texto y no pide plan", async () => {
    const planDe = vi.fn(async () => planProducto());
    const { deps, llamadas } = crearDeps(() => 5);
    const r = await buscar(pedido({ consulta: "!!!", filtros: { categorias: ["Lámparas"] } }), legado("catalogo", { planDe }), deps);
    expect(planDe).not.toHaveBeenCalled();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].filtros).toEqual({ categorias: ["Lámparas"] });
    expect("texto" in llamadas[0].filtros).toBe(false);
    expect(r).toMatchObject({ etapa: "sin-texto", intentos: ["sin-texto"] });
  });

  it("sin consulta, igual", async () => {
    const { deps, llamadas } = crearDeps(() => 5);
    const r = await buscar(pedido({ consulta: undefined }), legado("autocompletar", { planDe: async () => planProducto() }), deps);
    expect(llamadas[0].filtros.texto).toBeUndefined();
    expect(r.etapa).toBe("sin-texto");
  });

  it("conPlan apagado: planDe no se llama y no hay etapa plan", async () => {
    const planDe = vi.fn(async () => planProducto());
    const { deps, llamadas } = crearDeps(() => 0);
    const r = await buscar(pedido(), legado("autocompletar", { conPlan: false, planDe }), deps);
    expect(planDe).not.toHaveBeenCalled();
    expect(llamadas.some((l) => l.filtros.texto?.plan)).toBe(false);
    expect(r.plan).toBeNull();
  });

  it("autocompletar: una consulta que parece código no pide plan", async () => {
    const planDe = vi.fn(async () => planProducto());
    const { deps } = crearDeps(() => 1);
    await buscar(pedido({ consulta: CODIGO }), legado("autocompletar", { planDe }), deps);
    expect(planDe).not.toHaveBeenCalled();
  });

  it("planDe que devuelve null o falla = sin plan, no es un error", async () => {
    const { deps, llamadas } = crearDeps(() => 0);
    for (const planDe of [async () => null, async () => Promise.reject(new Error("plan roto"))]) {
      llamadas.length = 0;
      const r = await buscar(pedido(), legado("catalogo", { planDe }), deps);
      expect(llamadas.map((l) => l.filtros.texto)).toEqual([{ q: CONSULTA }, { q: CONSULTA, tolerante: true }]);
      expect(r.plan).toBeNull();
    }
  });

  it("el plan resuelto vuelve en el resultado aunque no haya intervenido (intención código)", async () => {
    const plan = planProducto({ intencion: "codigo" });
    const { deps, llamadas } = crearDeps(() => 2);
    const r = await buscar(pedido(), legado("catalogo", { planDe: async () => plan }), deps);
    expect(llamadas[0].filtros.texto).toEqual({ q: CONSULTA });
    expect(r.plan).toBe(plan);
  });

  it("costura: un plan con atributos de ids arbitrarios llega INTACTO a la lectura de la etapa plan", async () => {
    const plan = planProducto({
      duros: { categorias: [], atributos: ["corriente_a:20", "id-fuera-del-diccionario"] },
      blandos: {
        categorias: [],
        atributos: [{ id: "corriente_a:20", peso: 1 }, { id: "tension_v:24", peso: 0.8 }],
        terminos: [{ texto: "panel", peso: 1 }, { texto: "conductor", peso: 0.7 }],
      },
    });
    const { deps, llamadas } = crearDeps(() => 1);
    // Los duros viajan como filtros (así los lee la página de la URL): llegan tal cual y no se
    // descuentan dos veces de lo blando, salvo las medidas (`criterioDe`, M2 de busqueda-medidas): su
    // duro es "sin contradicción" y no puntúa, así que el blando sigue subiendo a los que tienen el
    // dato. Lo blando restante pasa sin que el motor lo interprete.
    const filtros = { atributos: ["corriente_a:20", "id-fuera-del-diccionario"] };
    await buscar(pedido({ filtros }), legado("catalogo", { planDe: async () => plan }), deps);
    expect(llamadas[0].filtros.atributos).toEqual(filtros.atributos);
    expect(llamadas[0].filtros.texto?.plan?.blandos).toEqual({
      categorias: [],
      atributos: [{ id: "corriente_a:20", peso: 1 }, { id: "tension_v:24", peso: 0.8 }],
      terminos: plan.blandos.terminos,
    });
    // Sin duros en la URL (autocompletar), todos los blandos llegan, ids arbitrarios incluidos.
    llamadas.length = 0;
    await buscar(pedido({ porPagina: 8 }), legado("autocompletar", { planDe: async () => plan }), deps);
    expect(llamadas[0].filtros.texto?.plan?.blandos).toEqual(plan.blandos);
  });
});

describe("buscar: degradación y errores", () => {
  const roto = new Error("pg_trgm no está");

  it("catálogo: si la tolerante falla, queda la exacta vacía (no se propaga)", async () => {
    const { deps } = crearDeps((a) => (a.filtros.texto?.tolerante ? roto : 0));
    const r = await buscar(pedido(), legado("catalogo"), deps);
    expect(r).toMatchObject({ etapa: "vacio", total: 0, intentos: ["exacta", "tolerante"] });
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it("el aviso de la etapa que falló no incluye la consulta", async () => {
    const consulta = "consulta-secreta";
    const { deps } = crearDeps((a) => (a.filtros.texto?.tolerante ? new Error(`falló con ${consulta}`) : 0));
    await buscar(pedido({ consulta }), legado("catalogo"), deps);
    const mensajes = vi.mocked(deps.log!).mock.calls.map((c) => c[0]).join(" ");
    expect(mensajes).not.toContain(consulta);
    expect(mensajes).toContain("tolerante");
  });

  it("catálogo: si la exacta falla, se propaga", async () => {
    const { deps } = crearDeps(() => roto);
    await expect(buscar(pedido(), legado("catalogo"), deps)).rejects.toBe(roto);
  });

  it("catálogo: si el plan falla, se propaga (la página muestra su error como hoy)", async () => {
    const { deps } = crearDeps((a) => (a.filtros.texto?.plan ? roto : 1));
    await expect(buscar(pedido(), legado("catalogo", { planDe: async () => planProducto() }), deps)).rejects.toBe(roto);
  });

  it("autocompletar: si el plan falla, sigue con la exacta", async () => {
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.plan ? roto : 2));
    const r = await buscar(pedido({ porPagina: 8 }), legado("autocompletar", { planDe: async () => planProducto() }), deps);
    expect(r).toMatchObject({ etapa: "exacta", total: 2, intentos: ["plan", "exacta"] });
    expect(llamadas).toHaveLength(2);
  });

  it("autocompletar: si la exacta falla, se propaga", async () => {
    const { deps } = crearDeps((a) => (a.filtros.texto?.plan ? 0 : roto));
    await expect(buscar(pedido({ porPagina: 8 }), legado("autocompletar", { planDe: async () => planProducto() }), deps)).rejects.toBe(roto);
  });

  it("chat: si la tolerante falla queda lo exacto (vacío); si falla la exacta, 502 (se propaga)", async () => {
    const a = crearDeps((args) => (args.filtros.texto?.tolerante ? roto : 0));
    expect(await buscar(pedido(), legado("chat"), a.deps)).toMatchObject({ etapa: "vacio", total: 0 });
    const b = crearDeps(() => roto);
    await expect(buscar(pedido(), legado("chat"), b.deps)).rejects.toBe(roto);
  });

  it("admin: no degrada nada", async () => {
    const { deps } = crearDeps(() => roto);
    await expect(buscar(pedido(), legado("admin"), deps)).rejects.toBe(roto);
  });
});

describe("buscar: filtrosEfectivos y facetas", () => {
  it("son los filtros (con texto) de la etapa ganadora", async () => {
    const { deps } = crearDeps((a) => (a.filtros.texto?.tolerante ? 1 : 0));
    const r = await buscar(pedido({ filtros: { categorias: ["Lámparas"] } }), legado("catalogo"), deps);
    expect(r.filtrosEfectivos).toEqual({ categorias: ["Lámparas"], texto: { q: CONSULTA, tolerante: true } });
  });

  it("si ninguna etapa trae nada, son los de la PRIMERA etapa corrida", async () => {
    const { deps } = crearDeps(() => 0);
    const r = await buscar(pedido(), legado("catalogo"), deps);
    expect(r.etapa).toBe("vacio");
    expect(r.filtrosEfectivos.texto).toEqual({ q: CONSULTA });
    // La página sigue de pie: pagina/paginas de esa etapa.
    expect(r).toMatchObject({ pagina: 1, paginas: 1 });
  });

  it("con conFacetas, cada etapa lee página y facetas con los MISMOS filtros y vuelven las de la ganadora", async () => {
    const { deps, llamadas, facetas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 1 : 0));
    const r = await buscar(pedido(), legado("catalogo", { conFacetas: true }), deps);
    expect(facetas).toEqual(llamadas.map((l) => l.filtros));
    expect(facetas).toHaveLength(2);
    expect(r.facetas).toBeDefined();
  });

  it("sin conFacetas no se leen facetas", async () => {
    const { deps, facetas } = crearDeps(() => 1);
    const r = await buscar(pedido(), legado("catalogo"), deps);
    expect(facetas).toHaveLength(0);
    expect(r.facetas).toBeUndefined();
  });

  it("`ms` sale del reloj inyectado", async () => {
    const tiempos = [1000, 1250];
    const { deps } = crearDeps(() => 1);
    const r = await buscar(pedido(), legado("chat"), { ...deps, ahora: () => tiempos.shift() ?? 1250 });
    expect(r.ms).toBe(250);
  });
});


// ---------------------------------------------------------------------------------------------
// Política `cascada` (PR2): código -> plan -> exacta -> tolerante, con presupuestos por etapa.
// ---------------------------------------------------------------------------------------------

const cascada = (superficie: OpcionesBuscar["superficie"], extra: Partial<OpcionesBuscar> = {}): OpcionesBuscar => ({
  superficie,
  politica: "cascada",
  conPlan: true,
  ...extra,
});

const etapasC = (a: Partial<Parameters<typeof etapasDe>[0]>) =>
  etapasDe({ politica: "cascada", superficie: "catalogo", consulta: CONSULTA, plan: null, conPlan: true, ...a });

/** Un plan que NO aporta nada a la clásica: sin duros ni blandos, sólo el término original. */
const planQueNoAporta = (): PlanBusqueda => ({
  ...planVacio(CONSULTA),
  blandos: { categorias: [], atributos: [], terminos: [{ texto: "panel", peso: 1 }] },
});

describe("etapasDe: política cascada", () => {
  it("consulta que parece código (G): código y tolerante sobre el código, sin plan", () => {
    expect(etapasC({ consulta: CODIGO })).toEqual(["codigo", "tolerante"]);
    expect(etapasC({ consulta: CODIGO, plan: planProducto() })).toEqual(["codigo", "tolerante"]);
    expect(etapasC({ consulta: CODIGO, conPlan: false })).toEqual(["codigo", "tolerante"]);
    expect(etapasC({ consulta: CODIGO.replace("-", "") })).toEqual(["codigo", "tolerante"]);
  });

  it("un token que es una medida pura ('20a', 'e27', 'ip65') ya no es G: usa el plan como cualquier consulta (M1c)", () => {
    for (const consulta of ["20a", "e27", "ip65", "9w", "6ka", "4000k"]) {
      expect(pareceCodigo(consulta)).toBe(false);
      expect(etapasC({ consulta })).not.toContain("codigo");
      expect(etapasC({ consulta, plan: planProducto() })).toContain("plan");
      expect(necesitaPlan({ politica: "cascada", superficie: "catalogo", consulta, conPlan: true })).toBe(true);
    }
  });

  it("lo que tiene la forma de una medida pero cae fuera de rango sigue siendo G ('12000k', 'ip70')", () => {
    for (const consulta of ["12000k", "ip70"]) {
      expect(etapasC({ consulta, plan: planProducto() })).toEqual(["codigo", "tolerante"]);
      expect(necesitaPlan({ politica: "cascada", superficie: "catalogo", consulta, conPlan: true })).toBe(false);
    }
  });

  it("un plan de intención código también es G (aunque la consulta no parezca un código)", () => {
    expect(etapasC({ consulta: "conector rapido", plan: planProducto({ intencion: "codigo" }) })).toEqual(["codigo", "tolerante"]);
  });

  it("G necesita 3 o más caracteres normalizados: «e2» no tiene etapa de código", () => {
    expect(pareceCodigo("e2")).toBe(true);
    expect(etapasC({ consulta: "e2" })).toEqual(["exacta"]);
  });

  it("plan que aporta (P y A): plan, exacta, tolerante", () => {
    expect(etapasC({ plan: planProducto() })).toEqual(["plan", "exacta", "tolerante"]);
    expect(etapasC({ plan: planProducto(), superficie: "autocompletar" })).toEqual(["plan", "exacta", "tolerante"]);
    expect(etapasC({ plan: planProducto(), superficie: "chat" })).toEqual(["plan", "exacta", "tolerante"]);
  });

  it("plan que no aporta (P y no A): exacta, plan, tolerante", () => {
    expect(etapasC({ plan: planQueNoAporta() })).toEqual(["exacta", "plan", "tolerante"]);
  });

  it("sin plan, con conPlan apagado o con un plan de intención código: exacta y tolerante", () => {
    expect(etapasC({})).toEqual(["exacta", "tolerante"]);
    expect(etapasC({ plan: planProducto(), conPlan: false })).toEqual(["exacta", "tolerante"]);
    for (const superficie of ["catalogo", "autocompletar", "chat", "admin"] as const) {
      expect(etapasC({ superficie, plan: planProducto(), conPlan: false })).not.toContain("plan");
    }
  });

  it("el selector del admin nunca usa plan", () => {
    expect(etapasC({ superficie: "admin", plan: planProducto() })).toEqual(["exacta", "tolerante"]);
  });

  it("la tolerante se omite sin términos de 4 letras o más (y sin ser código)", () => {
    expect(etapasC({ consulta: "9w" })).toEqual(["exacta"]);
    expect(etapasC({ consulta: "9w e27", plan: planProducto() })).toEqual(["plan", "exacta"]);
    expect(etapasC({ consulta: "9w lampara" })).toEqual(["exacta", "tolerante"]);
  });

  it("sin texto o sin términos: una lectura sin texto", () => {
    for (const consulta of ["", "   ", "!!!"]) expect(etapasC({ consulta, plan: planProducto() })).toEqual(["sin-texto"]);
  });

  it("necesitaPlan en cascada: con texto y busqueda-ia, salvo admin y lo que parece un código", () => {
    const n = (a: Partial<Parameters<typeof necesitaPlan>[0]>) =>
      necesitaPlan({ politica: "cascada", superficie: "catalogo", consulta: CONSULTA, conPlan: true, ...a });
    expect(n({})).toBe(true);
    expect(n({ superficie: "autocompletar" })).toBe(true);
    expect(n({ superficie: "chat" })).toBe(true);
    expect(n({ superficie: "admin" })).toBe(false);
    expect(n({ conPlan: false })).toBe(false);
    expect(n({ consulta: "" })).toBe(false);
    expect(n({ consulta: CODIGO })).toBe(false);
  });
});

describe("buscar: política cascada", () => {
  it("salida temprana: si el plan trae resultados no corren ni exacta ni tolerante", async () => {
    const { deps, llamadas } = crearDeps(() => 4);
    const r = await buscar(pedido(), cascada("catalogo", { planDe: async () => planProducto() }), deps);
    expect(llamadas).toHaveLength(1);
    expect(r).toMatchObject({ etapa: "plan", intentos: ["plan"], total: 4 });
  });

  it("typo con plan en el catálogo: plan 0, exacta 0, tolerante CONSERVANDO el plan y los duros", async () => {
    const plan = planProducto({
      blandos: {
        categorias: [{ nombre: "Plafones", peso: 0.9 }],
        atributos: [{ id: "corriente_a:20", peso: 1 }, { id: "id-fuera-del-diccionario", peso: 0.8 }],
        terminos: [{ texto: "plafon", peso: 1 }],
      },
    });
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 3 : 0));
    const filtros = { categorias: ["Lámparas"], atributos: ["tono-calido"] };
    const r = await buscar(pedido({ consulta: "plafom", filtros }), cascada("catalogo", { planDe: async () => plan }), deps);
    expect(r).toMatchObject({ etapa: "tolerante", intentos: ["plan", "exacta", "tolerante"], total: 3 });
    const criterio = criterioDe(plan, { categorias: ["Lámparas"], atributos: ["tono-calido"] });
    expect(llamadas.map((l) => l.filtros.texto)).toEqual([
      { q: "plafom", plan: criterio },
      { q: "plafom" },
      { q: "plafom", tolerante: true, plan: criterio },
    ]);
    // Los duros siguen siendo filtros en la etapa tolerante y el plan llega intacto (ids arbitrarios).
    expect(llamadas[2].filtros.categorias).toEqual(["Lámparas"]);
    expect(llamadas[2].filtros.atributos).toEqual(["tono-calido"]);
    expect(llamadas[2].filtros.texto?.plan?.blandos.atributos).toEqual([
      { id: "corriente_a:20", peso: 1 },
      { id: "id-fuera-del-diccionario", peso: 0.8 },
    ]);
    expect(r.filtrosEfectivos.texto).toEqual({ q: "plafom", tolerante: true, plan: criterio });
  });

  it("plan que no aporta: `intentos` empieza por la exacta y el plan corre sólo si la exacta dio 0", async () => {
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.plan ? 2 : 0));
    const r = await buscar(pedido(), cascada("catalogo", { planDe: async () => planQueNoAporta() }), deps);
    expect(r.intentos).toEqual(["exacta", "plan"]);
    expect(r.etapa).toBe("plan");
    expect(llamadas[0].filtros.texto).toEqual({ q: CONSULTA });
    // Y si la exacta ya trae resultados, ahí termina.
    const otra = crearDeps(() => 5);
    const r2 = await buscar(pedido(), cascada("catalogo", { planDe: async () => planQueNoAporta() }), otra.deps);
    expect(r2).toMatchObject({ etapa: "exacta", intentos: ["exacta"] });
  });

  it("cero resultados en todas las etapas: etapa vacío, total 0 y sin productos", async () => {
    const { deps } = crearDeps(() => 0);
    const r = await buscar(pedido(), cascada("catalogo", { planDe: async () => planProducto() }), deps);
    expect(r).toMatchObject({ etapa: "vacio", total: 0, productos: [], intentos: ["plan", "exacta", "tolerante"] });
    expect(r.truncado).toBeUndefined();
  });

  it("código: DL-18W y DL18W resuelven en la etapa código, sin pedir plan ni correr la tolerante", async () => {
    for (const consulta of [CODIGO, CODIGO.replace("-", "")]) {
      const planDe = vi.fn(async () => planProducto());
      const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.codigo && !a.filtros.texto.tolerante ? 1 : 0));
      const r = await buscar(pedido({ consulta }), cascada("catalogo", { planDe }), deps);
      expect(planDe).not.toHaveBeenCalled();
      expect(llamadas).toHaveLength(1);
      expect(llamadas[0].filtros.texto).toEqual({ q: consulta, codigo: true });
      expect(r).toMatchObject({ etapa: "codigo", intentos: ["codigo"] });
    }
  });

  it("código: el trigrama (tolerante sobre el código) corre SÓLO si no hubo coincidencia; sin plan", async () => {
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 2 : 0));
    const r = await buscar(pedido({ consulta: CODIGO }), cascada("catalogo", { planDe: async () => planProducto() }), deps);
    expect(llamadas.map((l) => l.filtros.texto)).toEqual([
      { q: CODIGO, codigo: true },
      { q: CODIGO, tolerante: true, codigo: true },
    ]);
    expect(r).toMatchObject({ etapa: "tolerante", total: 2 });
  });

  it("el motor decide G con el `pareceCodigo` real de gate (no lo reimplementa)", async () => {
    const { deps, llamadas } = crearDeps(() => 1);
    await buscar(pedido({ consulta: CONSULTA }), cascada("autocompletar"), deps);
    expect(llamadas[0].filtros.texto?.codigo).toBeUndefined();
    await buscar(pedido({ consulta: CODIGO }), cascada("autocompletar"), deps);
    expect(llamadas[1].filtros.texto?.codigo).toBe(true);
  });

  it("autocompletar: plan, exacta, tolerante, sin conteo, porPagina = límite y estructurados en todas las etapas", async () => {
    const { deps, llamadas } = crearDeps(() => 0);
    const r = await buscar(
      pedido({ porPagina: 8, filtros: { atributosEstructurados: true } }),
      cascada("autocompletar", { planDe: async () => planProducto() }),
      deps,
    );
    expect(r.intentos).toEqual(["plan", "exacta", "tolerante"]);
    expect(llamadas.every((l) => l.sinConteo && l.porPagina === 8 && l.pagina === 1)).toBe(true);
    expect(llamadas.every((l) => l.filtros.atributosEstructurados === true)).toBe(true);
    expect(llamadas.every((l) => l.filtros.soloStock === undefined)).toBe(true);
  });

  it("autocompletar: ESPERA al plan lento (como el legado) en vez de descartarlo a los 250 ms", async () => {
    vi.useFakeTimers();
    // La búsqueda del banco y la de un miss real recomputan el plan con varios COUNT: tarda más que 250 ms.
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.plan ? 3 : 0));
    const planDe = () => new Promise<PlanBusqueda | null>((resolver) => setTimeout(() => resolver(planProducto()), 3000));
    const promesa = buscar(pedido({ porPagina: 8 }), cascada("autocompletar", { planDe }), deps);
    await vi.advanceTimersByTimeAsync(3000);
    const r = await promesa;
    expect(r.plan).not.toBeNull();
    expect(r).toMatchObject({ etapa: "plan", intentos: ["plan"], total: 3 });
    expect(llamadas[0].filtros.texto?.plan).toBeDefined();
  });

  describe("autocompletar con el plan LENTO: la cascada nunca queda peor que el legado", () => {
    // Cada escenario dice qué devuelve cada tipo de lectura. Con el plan más lento que cualquier tope,
    // la cascada tiene que encontrar algo siempre que el legado lo encuentre.
    const escenarios: { nombre: string; consulta: string; plan: PlanBusqueda; tabla: { plan?: number; exacta?: number; tolerante?: number } }[] = [
      { nombre: "lenguaje natural: la AND de todas las palabras no encuentra, el plan sí", consulta: "tira led para la cocina", plan: planProducto(), tabla: { plan: 5 } },
      { nombre: "medida: la exacta no encuentra, el plan sí", consulta: "panel led 60x60", plan: planProducto(), tabla: { plan: 4 } },
      { nombre: "typo: sólo la tolerante encuentra", consulta: "lampra led e27", plan: planProducto(), tabla: { tolerante: 2 } },
      { nombre: "el plan no trae nada y la exacta sí", consulta: "panel led", plan: planProducto(), tabla: { exacta: 3 } },
      { nombre: "el plan no aporta y la exacta ya trae", consulta: "panel led", plan: planQueNoAporta(), tabla: { exacta: 3, plan: 1 } },
      { nombre: "nada en ninguna etapa", consulta: "xyzzy inexistente", plan: planProducto(), tabla: {} },
    ];

    async function correr(politica: "legado" | "cascada", e: (typeof escenarios)[number]) {
      vi.useFakeTimers();
      const { deps } = crearDeps((a) => {
        const t = a.filtros.texto;
        return (t?.tolerante ? e.tabla.tolerante : t?.plan ? e.tabla.plan : e.tabla.exacta) ?? 0;
      });
      // El plan tarda 5 s en el reloj de los temporizadores y 5 s en el reloj inyectado.
      let reloj = 0;
      const planDe = () => new Promise<PlanBusqueda | null>((resolver) => setTimeout(() => ((reloj += 5000), resolver(e.plan)), 5000));
      const promesa = buscar(pedido({ consulta: e.consulta, porPagina: 8 }), { superficie: "autocompletar", politica, conPlan: true, planDe }, { ...deps, ahora: () => reloj });
      await vi.advanceTimersByTimeAsync(5000);
      return promesa;
    }

    for (const e of escenarios) {
      it(e.nombre, async () => {
        const legadoR = await correr("legado", e);
        const cascadaR = await correr("cascada", e);
        expect(cascadaR.total > 0).toBe(legadoR.total > 0);
        expect(cascadaR.total).toBeGreaterThanOrEqual(legadoR.total);
        expect(cascadaR.truncado).toBeUndefined();
      });
    }
  });

  it("un plan lento no consume el presupuesto de las etapas: el reloj de las etapas arranca cuando llega el plan", async () => {
    let t = 0;
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 2 : 0));
    const lenta: DepsMotor = { ...deps, ahora: () => t, pagina: async (a) => { t += 100; return deps.pagina(a); } };
    const planLento = async () => {
      t += 600; // ya más que el presupuesto (450) del autocompletar
      return planProducto();
    };
    const r = await buscar(pedido({ porPagina: 8 }), cascada("autocompletar", { planDe: planLento }), lenta);
    expect(llamadas).toHaveLength(3);
    expect(r).toMatchObject({ etapa: "tolerante", intentos: ["plan", "exacta", "tolerante"], total: 2 });
    expect(r.truncado).toBeUndefined();
  });

  it("sinTopes: el banco mide calidad, no relojes: ni presupuesto ni tope de plan", async () => {
    vi.useFakeTimers();
    let t = 0;
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 2 : 0));
    const lenta: DepsMotor = { ...deps, ahora: () => t, pagina: async (a) => { t += 5000; return deps.pagina(a); } };
    // Chat tiene presupuesto (1500 ms): sin topes no rige.
    const planDe = () => new Promise<PlanBusqueda | null>((resolver) => setTimeout(() => resolver(planProducto()), 10_000));
    const promesa = buscar(pedido({ porPagina: 10 }), cascada("chat", { planDe, sinTopes: true }), lenta);
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await promesa;
    expect(r.plan).not.toBeNull();
    expect(llamadas).toHaveLength(3);
    expect(r).toMatchObject({ etapa: "tolerante", total: 2 });
    expect(r.truncado).toBeUndefined();
  });

  it("chat: usa el plan en cascada y, como el autocompletar, lo ESPERA (sin tope de plan: descartarlo dejaba la búsqueda vacía)", async () => {
    expect(PRESUPUESTOS_CASCADA.chat.planTimeoutMs).toBeNull();
    expect(PRESUPUESTOS_CASCADA.catalogo.planTimeoutMs).toBeNull();
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.plan ? 3 : 0));
    const r = await buscar(pedido({ porPagina: 10 }), cascada("chat", { planDe: async () => planProducto() }), deps);
    expect(r.etapa).toBe("plan");
    expect(llamadas[0]).toMatchObject({ sinConteo: true, porPagina: 10 });
  });

  it("chat: un plan LENTO (más que cualquier tope viejo) no se descarta y su espera no gasta el presupuesto de las etapas", async () => {
    vi.useFakeTimers();
    let t = 0;
    const { deps, llamadas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 2 : 0));
    const reloj: DepsMotor = { ...deps, ahora: () => t, pagina: async (a) => { t += 100; return deps.pagina(a); } };
    // 5 s de plan, más que los 600 ms del tope viejo y que los 1500 ms del presupuesto del chat.
    const planDe = () => new Promise<PlanBusqueda | null>((resolver) => setTimeout(() => ((t += 5000), resolver(planProducto())), 5000));
    const promesa = buscar(pedido({ consulta: "lampra led", porPagina: 10 }), cascada("chat", { planDe }), reloj);
    await vi.advanceTimersByTimeAsync(5000);
    const r = await promesa;
    expect(r.plan).not.toBeNull();
    expect(llamadas).toHaveLength(3);
    expect(r).toMatchObject({ etapa: "tolerante", intentos: ["plan", "exacta", "tolerante"], total: 2 });
    expect(r.truncado).toBeUndefined();
  });

  describe("chat con el plan LENTO: la cascada nunca queda peor que el legado del chat (exacta y tolerante, sin plan)", () => {
    const escenarios: { nombre: string; consulta: string; plan: PlanBusqueda; tabla: { plan?: number; exacta?: number; tolerante?: number }; encuentra: boolean }[] = [
      { nombre: "lenguaje natural: sólo el plan encuentra (el legado del chat no)", consulta: "tira led para la cocina", plan: planProducto(), tabla: { plan: 5 }, encuentra: true },
      { nombre: "medida: sólo el plan encuentra", consulta: "panel led 60x60", plan: planProducto(), tabla: { plan: 4 }, encuentra: true },
      { nombre: "typo: sólo la tolerante encuentra (con o sin plan)", consulta: "lampra led e27", plan: planProducto(), tabla: { tolerante: 2 }, encuentra: true },
      { nombre: "el plan no trae nada y la exacta sí", consulta: "panel led", plan: planProducto(), tabla: { exacta: 3 }, encuentra: true },
      { nombre: "nada en ninguna etapa", consulta: "xyzzy inexistente", plan: planProducto(), tabla: {}, encuentra: false },
    ];

    async function correr(politica: "legado" | "cascada", e: (typeof escenarios)[number]) {
      vi.useFakeTimers();
      const { deps } = crearDeps((a) => {
        const t = a.filtros.texto;
        return (t?.tolerante ? e.tabla.tolerante : t?.plan ? e.tabla.plan : e.tabla.exacta) ?? 0;
      });
      let reloj = 0;
      const planDe = () => new Promise<PlanBusqueda | null>((resolver) => setTimeout(() => ((reloj += 5000), resolver(e.plan)), 5000));
      const promesa = buscar(pedido({ consulta: e.consulta, porPagina: 10 }), { superficie: "chat", politica, conPlan: true, planDe }, { ...deps, ahora: () => reloj });
      await vi.advanceTimersByTimeAsync(5000);
      return promesa;
    }

    for (const e of escenarios) {
      it(e.nombre, async () => {
        const legadoR = await correr("legado", e);
        const cascadaR = await correr("cascada", e);
        expect(cascadaR.total).toBeGreaterThanOrEqual(legadoR.total);
        expect(legadoR.total > 0 && cascadaR.total === 0).toBe(false);
        expect(cascadaR.total > 0).toBe(e.encuentra);
        expect(cascadaR.truncado).toBeUndefined();
      });
    }
  });

  it("los presupuestos por superficie son los del diseño", () => {
    expect(PRESUPUESTOS_CASCADA).toEqual({
      catalogo: { presupuestoMs: 3000, planTimeoutMs: null, etapasMax: 3 },
      autocompletar: { presupuestoMs: 450, planTimeoutMs: null, etapasMax: 3 },
      chat: { presupuestoMs: 1500, planTimeoutMs: null, etapasMax: 3 },
      admin: { presupuestoMs: 3000, planTimeoutMs: null, etapasMax: 2 },
    });
  });

  it("presupuesto: pasado el tiempo no se INICIA una etapa nueva (truncado, etapa vacío)", async () => {
    let t = 0;
    const { deps, llamadas } = crearDeps();
    // Cada lectura tarda 500 ms del reloj inyectado: el presupuesto del autocompletar es 450.
    const lenta: DepsMotor = { ...deps, ahora: () => t, pagina: async (a) => { t += 500; return deps.pagina(a); } };
    const r = await buscar(pedido({ porPagina: 8 }), cascada("autocompletar", { planDe: async () => planProducto() }), lenta);
    expect(llamadas).toHaveLength(1);
    expect(r).toMatchObject({ etapa: "vacio", truncado: true, total: 0, productos: [], intentos: ["plan"] });
  });

  it("presupuesto: dentro del tiempo corren todas las etapas", async () => {
    let t = 0;
    const { deps, llamadas } = crearDeps();
    const rapida: DepsMotor = { ...deps, ahora: () => t, pagina: async (a) => { t += 100; return deps.pagina(a); } };
    const r = await buscar(pedido({ porPagina: 8 }), cascada("autocompletar", { planDe: async () => planProducto() }), rapida);
    expect(llamadas).toHaveLength(3);
    expect(r.truncado).toBeUndefined();
  });

  it("presupuesto del catálogo: 3000 ms", async () => {
    let t = 0;
    const { deps, llamadas } = crearDeps();
    const medio: DepsMotor = { ...deps, ahora: () => t, pagina: async (a) => { t += 2000; return deps.pagina(a); } };
    const r = await buscar(pedido(), cascada("catalogo"), medio);
    // exacta (2000) y tolerante (arranca a los 2000 < 3000): las dos corren.
    expect(llamadas).toHaveLength(2);
    expect(r.truncado).toBeUndefined();
  });

  it("el legado NO tiene presupuesto: corre todas las etapas aunque tarden", async () => {
    let t = 0;
    const { deps, llamadas } = crearDeps();
    const lenta: DepsMotor = { ...deps, ahora: () => t, pagina: async (a) => { t += 99_999; return deps.pagina(a); } };
    const r = await buscar(pedido({ porPagina: 8 }), legado("autocompletar", { planDe: async () => planProducto() }), lenta);
    expect(llamadas).toHaveLength(3);
    expect(r.truncado).toBeUndefined();
  });

  it("errores: el plan y la tolerante degradan; la exacta, la de código y la sin texto se propagan", async () => {
    const roto = new Error("pg caído");
    const a = crearDeps((args) => (args.filtros.texto?.plan ? roto : 2));
    expect(await buscar(pedido(), cascada("catalogo", { planDe: async () => planProducto() }), a.deps)).toMatchObject({ etapa: "exacta", intentos: ["plan", "exacta"] });
    const b = crearDeps((args) => (args.filtros.texto?.tolerante ? roto : 0));
    expect(await buscar(pedido(), cascada("catalogo"), b.deps)).toMatchObject({ etapa: "vacio", total: 0 });
    const c = crearDeps(() => roto);
    await expect(buscar(pedido(), cascada("catalogo"), c.deps)).rejects.toBe(roto);
    const d = crearDeps(() => roto);
    await expect(buscar(pedido({ consulta: CODIGO }), cascada("catalogo"), d.deps)).rejects.toBe(roto);
  });

  it("planDe recibe la consulta CRUDA (sólo trim) también en cascada", async () => {
    const planDe = vi.fn(async () => null);
    const { deps } = crearDeps(() => 1);
    await buscar(pedido({ consulta: "  bipolar 9,5w " }), cascada("catalogo", { planDe }), deps);
    expect(planDe).toHaveBeenCalledWith("bipolar 9,5w");
  });

  it("conPlan apagado: planDe no se llama y no hay etapa plan, con cualquier superficie", async () => {
    for (const superficie of ["catalogo", "autocompletar", "chat", "admin"] as const) {
      const planDe = vi.fn(async () => planProducto());
      const { deps, llamadas } = crearDeps(() => 0);
      const r = await buscar(pedido(), cascada(superficie, { conPlan: false, planDe }), deps);
      expect(planDe).not.toHaveBeenCalled();
      expect(r.plan).toBeNull();
      expect(llamadas.some((l) => l.filtros.texto?.plan)).toBe(false);
    }
  });

  it("el motor nunca llama a planParaBuscar ni a Jev: sólo consume el planDe inyectado", () => {
    const fuente = readFileSync(join(__dirname, "motor.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(fuente).not.toMatch(/planParaBuscar/);
    expect(fuente).not.toMatch(/jev/i);
  });

  it("filtrosEfectivos y facetas: las de la etapa tolerante (con la condición tolerante y el plan)", async () => {
    const { deps, facetas } = crearDeps((a) => (a.filtros.texto?.tolerante ? 1 : 0));
    const r = await buscar(pedido(), cascada("catalogo", { planDe: async () => planProducto(), conFacetas: true }), deps);
    expect(r.etapa).toBe("tolerante");
    expect(r.filtrosEfectivos.texto).toMatchObject({ q: CONSULTA, tolerante: true });
    expect(r.filtrosEfectivos.texto?.plan).toBeDefined();
    expect(facetas).toHaveLength(3);
    expect(facetas[2]).toEqual(r.filtrosEfectivos);
  });
});

afterEach(() => vi.useRealTimers());

describe("costura de imports del motor", () => {
  const dir = join(__dirname);
  const imports = (archivo: string) =>
    [...readFileSync(join(dir, archivo), "utf8").matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => ({
      soloTipo: !!m[1],
      especificador: m[2],
    }));
  const PROHIBIDOS = /jev|servidor|^@\/flags$|^flags(\/|$)|entender|medidas|^next(\/|$)|\/flags$/;

  it("motor.ts no importa jev, servidor, flags, entender, medidas ni next, y de catalog sólo tipos", () => {
    const lista = imports("motor.ts");
    expect(lista.length).toBeGreaterThan(0);
    for (const { soloTipo, especificador } of lista) {
      expect(especificador, `import ${especificador}`).not.toMatch(PROHIBIDOS);
      if (/(^|\/)catalog$/.test(especificador)) expect(soloTipo, `import de ${especificador} debe ser de tipos`).toBe(true);
    }
  });

  it("lo que motor.ts importa como valor tampoco arrastra jev, servidor ni flags", () => {
    for (const archivo of ["destino.ts", "buscar.ts"]) {
      for (const { soloTipo, especificador } of imports(archivo)) {
        if (!soloTipo) expect(especificador, `${archivo} -> ${especificador}`).not.toMatch(PROHIBIDOS);
      }
    }
  });

  it("no reimplementa pareceCodigo: lo importa de gate", () => {
    const fuente = readFileSync(join(dir, "motor.ts"), "utf8");
    expect(fuente).toMatch(/import \{[^}]*pareceCodigo[^}]*\} from "\.\.\/busqueda-inteligente\/gate"/);
    expect(fuente).not.toMatch(/function pareceCodigo/);
  });
});

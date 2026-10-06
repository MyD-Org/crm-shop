import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";
import type { Facetas, FiltrosCatalogo, PaginaCatalogo } from "../catalog";
import { pareceCodigo } from "../busqueda-inteligente/gate";
import { buscar, etapasDe, necesitaPlan, sinTexto, type DepsMotor, type OpcionesBuscar, type PedidoBuscar } from "./motor";
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
    // descuentan dos veces de lo blando. Lo blando restante pasa sin que el motor lo interprete.
    const filtros = { atributos: ["corriente_a:20", "id-fuera-del-diccionario"] };
    await buscar(pedido({ filtros }), legado("catalogo", { planDe: async () => plan }), deps);
    expect(llamadas[0].filtros.atributos).toEqual(filtros.atributos);
    expect(llamadas[0].filtros.texto?.plan?.blandos).toEqual({
      categorias: [],
      atributos: [{ id: "tension_v:24", peso: 0.8 }],
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

  it("la política cascada todavía no está implementada", async () => {
    const { deps } = crearDeps();
    await expect(buscar(pedido(), { ...legado("catalogo"), politica: "cascada" }, deps)).rejects.toThrow(/cascada/);
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

describe("costura de imports del motor", () => {
  const dir = join(__dirname);
  const imports = (archivo: string) =>
    [...readFileSync(join(dir, archivo), "utf8").matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => ({
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

/**
 * Motor único de búsqueda del Shop (cambio `busqueda-motor-unico`): UNA fachada, `buscar()`, para
 * las cuatro superficies que leen el catálogo con texto (catálogo, autocompletar, chat del
 * vendedor y selector del admin). Decide qué lecturas hacen falta y en qué orden (las "etapas") y
 * qué `texto` lleva cada una; no sabe nada de SQL.
 *
 * Módulo PURO: sin base, red, Jev, Vercel Flags, `entender()` ni medidas. Lo que necesita llega
 * como dependencia (`DepsMotor`: leer una página, leer facetas, reloj, log) y el plan como función
 * perezosa (`planDe`, el único punto de adquisición del plan). Por eso se prueba sin `vi.mock` y
 * el banco lo corre con otras dependencias. El cableado de verdad vive en `motor-servidor.ts`.
 *
 * Una sola política, la cascada: código (si la consulta parece un código) -> plan (si aporta) ->
 * exacta -> tolerante CONSERVANDO el plan y los duros; corta en la primera etapa con resultados y
 * tiene un presupuesto de tiempo y un tope de espera del plan por superficie (`PRESUPUESTOS_CASCADA`).
 * `busqueda-ia` apagado es el kill switch: sin plan (`conPlan: false`), la cascada queda en
 * exacta -> tolerante (o código -> tolerante).
 *
 * Reglas que no se rompen (spec `busqueda-motor-unico`):
 * - El motor NO reimplementa `pareceCodigo` (lo importa de gate.ts) ni edita ese módulo.
 * - `planDe` recibe la consulta CRUDA (sólo recortada): "9,5w" no se convierte en "9 5w" antes de
 *   llegar al plan. `terminosBusqueda` sólo decide si hay algo que buscar.
 * - El plan viaja intacto a las etapas (ids de atributo arbitrarios incluidos).
 * - Los avisos (`log`) nunca llevan la consulta.
 */
import type { Product } from "@/data/products";
import { pareceCodigo } from "../busqueda-inteligente/gate";
import type { Facetas, FiltrosCatalogo, FiltrosSinTexto, PaginaCatalogo, TextoBusqueda } from "../catalog";
import { normalizarCodigo, terminosBusqueda } from "../catalogo-busqueda";
import type { OrdenCatalogo } from "../catalogo-url";
import { aportaAlgo } from "./buscar";
import { criterioDe } from "./destino";
import type { PlanBusqueda } from "./plan";

export type Superficie = "catalogo" | "autocompletar" | "chat" | "admin";
export type Etapa = "sin-texto" | "codigo" | "plan" | "exacta" | "tolerante" | "vacio";

export type { FiltrosSinTexto };

/** Los mismos filtros sin el texto (todo lo demás pasa intacto): el motor es el único que arma `texto`. */
export function sinTexto(f: FiltrosCatalogo): FiltrosSinTexto {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { texto, ...resto } = f;
  return resto;
}

export interface PedidoBuscar {
  /** CRUDA (sólo recortada): se pasa tal cual a `planDe`. */
  consulta: string | undefined;
  /** Duros ya como filtros (URL, ids de atributo arbitrarios incluidos), marcas, precio, potencia, soloStock… */
  filtros: FiltrosSinTexto;
  orden: OrdenCatalogo;
  /** 1-based. Sin conteo se fuerza 1. */
  pagina: number;
  porPagina: number;
}

export interface OpcionesBuscar {
  superficie: Superficie;
  /** Flag `busqueda-ia` (kill switch): apagado, nunca hay etapa `plan` ni se pide plan. */
  conPlan: boolean;
  /** Perezoso: sólo se invoca si la secuencia lo necesita. Punto único de adquisición del plan. */
  planDe?: (consultaCruda: string) => Promise<PlanBusqueda | null>;
  /** Contar el total (por defecto: sólo el catálogo). */
  conteo?: boolean;
  /** Leer también las facetas de cada etapa (sólo la página del catálogo). */
  conFacetas?: boolean;
  /**
   * Ignora el presupuesto de tiempo y el tope de espera del plan de la cascada. Lo usa el
   * banco: mide CALIDAD (qué etapa resuelve, qué trae), no relojes, y corre lejos de la base (cada
   * lectura tarda órdenes de magnitud más que en el servidor), así que unos topes pensados para el
   * servidor lo harían medir otra cosa. En producción nunca se pasa.
   */
  sinTopes?: boolean;
}

export interface LecturaPagina {
  filtros: FiltrosCatalogo;
  orden: OrdenCatalogo;
  pagina: number;
  porPagina: number;
  sinConteo: boolean;
}

export interface DepsMotor {
  pagina(a: LecturaPagina): Promise<PaginaCatalogo>;
  facetas?(filtros: FiltrosCatalogo): Promise<Facetas>;
  ahora?: () => number;
  /** Avisos del motor. NUNCA reciben la consulta. */
  log?: (mensaje: string) => void;
}

export interface ResultadoBuscar {
  productos: Product[];
  total: number;
  /** `false` si no se contó (el total es sólo lo que trajo la lectura). */
  totalExacto: boolean;
  pagina: number;
  paginas: number;
  etapa: Etapa;
  /** Las etapas que se intentaron, en orden. */
  intentos: Etapa[];
  /** El plan RESUELTO (haya intervenido o no): la página lo usa para la franja. */
  plan: PlanBusqueda | null;
  /** Filtros (con `texto`) de la etapa con resultados o, si ninguna, los de la primera etapa corrida. */
  filtrosEfectivos: FiltrosCatalogo;
  facetas?: Facetas;
  /** Se agotó el presupuesto de tiempo antes de probar una etapa más. */
  truncado?: boolean;
  ms: number;
}

const admiteParecido = (termino: string) => termino.length >= 4;

/** Presupuesto de la cascada por superficie (valores iniciales: se calibran con el banco). */
export interface PresupuestoCascada {
  /**
   * No se INICIA una etapa nueva pasado este tiempo desde que llegó el plan (la DB no se cancela).
   * Acota las lecturas de la cascada; la espera del plan no cuenta (ver `planTimeoutMs`).
   * `null` = sin tope.
   */
  presupuestoMs: number | null;
  /**
   * Si el plan no responde en este tiempo se sigue sin plan. `null` = se espera el plan.
   * Descartar el plan deja a la consulta sólo con la AND de todas sus palabras: una frase en lenguaje
   * natural o una medida ("tira led para la cocina", "panel led 60x60") no encuentra nada. Un plan
   * recién calculado (miss de la caché) tarda más que un tope corto, así que el autocompletar lo espera.
   */
  planTimeoutMs: number | null;
  /** Etapas como máximo. */
  etapasMax: number;
}

export const PRESUPUESTOS_CASCADA: Record<Superficie, PresupuestoCascada> = {
  catalogo: { presupuestoMs: 3000, planTimeoutMs: null, etapasMax: 3 },
  // Espera al plan sin tope: un tope corto lo descartaba y la búsqueda caía en la exacta.
  autocompletar: { presupuestoMs: 450, planTimeoutMs: null, etapasMax: 3 },
  // Como el autocompletar: espera al plan (sin él "tira led para la cocina" o una medida no encuentra nada).
  // El presupuesto cuenta desde que llega el plan.
  chat: { presupuestoMs: 1500, planTimeoutMs: null, etapasMax: 3 },
  admin: { presupuestoMs: 3000, planTimeoutMs: null, etapasMax: 2 },
};

/** Qué superficies cuentan el total, y qué etapas degradan (el error pasa a la siguiente) en vez de propagarse. */
const CONTEO: Record<Superficie, boolean> = { catalogo: true, autocompletar: false, chat: false, admin: false };
const DEGRADA: readonly Etapa[] = ["plan", "tolerante"];

interface EntradaPlan {
  superficie: Superficie;
  consulta: string;
  conPlan: boolean;
}

/** ¿Esta búsqueda va a necesitar el plan? Evita pedirlo (y gastar) cuando ninguna etapa lo usa. */
export function necesitaPlan({ superficie, consulta, conPlan }: EntradaPlan): boolean {
  return conPlan && terminosBusqueda(consulta).length > 0 && superficie !== "admin" && !pareceCodigo(consulta);
}

/**
 * Las etapas que corre una búsqueda, en orden (pura). `plan` es el plan ya resuelto (o null);
 * un plan de intención "codigo" cuenta como sin plan.
 *
 * G (parece un código, o el plan lo dice, con 3 o más caracteres) => [codigo, tolerante]; con plan
 * que aporta => [plan, exacta, tolerante]; con plan que no aporta => [exacta, plan, tolerante]; sin
 * plan => [exacta, tolerante]. La `exacta` tras el `plan` es una red de seguridad (el plan recupera
 * por comienzo de palabra y la clásica por «contiene»): sólo corre si el plan dio 0.
 */
export function etapasDe({ superficie, consulta, plan, conPlan }: EntradaPlan & { plan: PlanBusqueda | null }): Etapa[] {
  const terminos = terminosBusqueda(consulta);
  if (terminos.length === 0) return ["sin-texto"];
  const esCodigo = !!normalizarCodigo(consulta) && (pareceCodigo(consulta) || (conPlan && plan?.intencion === "codigo"));
  if (esCodigo) return ["codigo", "tolerante"];
  const conPlanUsable = conPlan && !!plan && plan.intencion !== "codigo" && superficie !== "admin";
  const etapas: Etapa[] = conPlanUsable ? (aportaAlgo(plan) ? ["plan", "exacta"] : ["exacta", "plan"]) : ["exacta"];
  if (terminos.some(admiteParecido)) etapas.push("tolerante");
  return etapas.slice(0, PRESUPUESTOS_CASCADA[superficie].etapasMax);
}

const nombreDe = (err: unknown) => (err instanceof Error ? err.name : "desconocido");

/** El plan, perezoso: un plan que falla es "sin plan" y, con tope, uno que tarda demasiado también. */
async function resolverPlan(planDe: NonNullable<OpcionesBuscar["planDe"]>, q: string, topeMs: number | null): Promise<PlanBusqueda | null> {
  const pedido = (async () => {
    try {
      return await planDe(q);
    } catch {
      return null;
    }
  })();
  if (topeMs == null) return pedido;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<null>((resolver) => {
    temporizador = setTimeout(() => resolver(null), topeMs);
  });
  try {
    return await Promise.race([pedido, tope]);
  } finally {
    clearTimeout(temporizador);
  }
}

export async function buscar(p: PedidoBuscar, o: OpcionesBuscar, d: DepsMotor): Promise<ResultadoBuscar> {
  const ahora = d.ahora ?? Date.now;
  const inicio = ahora();
  const q = p.consulta?.trim() ?? "";
  const { presupuestoMs, planTimeoutMs } = o.sinTopes ? { presupuestoMs: null, planTimeoutMs: null } : PRESUPUESTOS_CASCADA[o.superficie];
  const entrada: EntradaPlan = { superficie: o.superficie, consulta: q, conPlan: o.conPlan };

  // Perezoso: sólo si alguna etapa lo va a usar.
  const plan = o.planDe && necesitaPlan(entrada) ? await resolverPlan(o.planDe, q, planTimeoutMs) : null;

  // El presupuesto acota las lecturas de la cascada, no la espera del plan.
  const inicioEtapas = ahora();
  const etapas = etapasDe({ ...entrada, plan });
  const conteo = o.conteo ?? CONTEO[o.superficie];
  // La tolerante conserva el plan (y con él los duros y los términos), si hubo etapa plan.
  const toleranteConPlan = etapas.includes("plan");
  const esCodigo = etapas.includes("codigo");
  const filtrosDe = (etapa: Etapa): FiltrosCatalogo => {
    const base: FiltrosCatalogo = { ...p.filtros };
    const criterio = () => criterioDe(plan!, { categorias: base.categorias ?? [], atributos: base.atributos ?? [] });
    let texto: TextoBusqueda | undefined;
    if (etapa === "exacta") texto = { q };
    else if (etapa === "codigo") texto = { q, codigo: true };
    else if (etapa === "tolerante") texto = { q, tolerante: true, ...(toleranteConPlan ? { plan: criterio() } : {}), ...(esCodigo ? { codigo: true } : {}) };
    else if (etapa === "plan") texto = { q, plan: criterio() };
    return texto ? { ...base, texto } : base;
  };

  const intentos: Etapa[] = [];
  let primera: { filtros: FiltrosCatalogo; pagina: PaginaCatalogo; facetas?: Facetas } | null = null;
  let ultimoError: unknown;
  let truncado = false;
  const armar = (etapa: Etapa, e: NonNullable<typeof primera>, vacio: boolean): ResultadoBuscar => ({
    productos: vacio ? [] : e.pagina.productos,
    total: vacio ? 0 : e.pagina.total,
    totalExacto: e.pagina.totalExacto ?? true,
    pagina: e.pagina.pagina,
    paginas: e.pagina.paginas,
    etapa,
    intentos,
    plan,
    filtrosEfectivos: e.filtros,
    ...(e.facetas ? { facetas: e.facetas } : {}),
    ...(truncado ? { truncado: true } : {}),
    ms: ahora() - inicio,
  });

  for (const etapa of etapas) {
    // Presupuesto: no se INICIA una etapa nueva pasado el tiempo (la primera siempre corre).
    if (presupuestoMs != null && intentos.length > 0 && ahora() - inicioEtapas >= presupuestoMs) {
      truncado = true;
      d.log?.(`[busqueda] presupuesto agotado antes de la etapa ${etapa}`);
      break;
    }
    intentos.push(etapa);
    const filtros = filtrosDe(etapa);
    let leida: { filtros: FiltrosCatalogo; pagina: PaginaCatalogo; facetas?: Facetas };
    try {
      const [pagina, facetas] = await Promise.all([
        d.pagina({ filtros, orden: p.orden, pagina: conteo ? p.pagina : 1, porPagina: p.porPagina, sinConteo: !conteo }),
        o.conFacetas && d.facetas ? d.facetas(filtros) : undefined,
      ]);
      leida = { filtros, pagina, ...(facetas ? { facetas } : {}) };
    } catch (err) {
      if (!DEGRADA.includes(etapa)) throw err;
      ultimoError = err;
      d.log?.(`[busqueda] falló la etapa ${etapa}: ${nombreDe(err)}`);
      continue;
    }
    primera ??= leida;
    if (leida.pagina.total > 0) return armar(etapa, leida, false);
  }
  // Si ninguna etapa llegó a leer, no hay "vacío" que mostrar: era un error.
  if (!primera) throw ultimoError;
  return armar("vacio", primera, true);
}

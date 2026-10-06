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
 * Políticas:
 * - `legado`: reproduce EXACTO lo que cada superficie hacía por su cuenta (catálogo: plan, o
 *   exacta y reintento tolerante; autocompletar: plan, exacta, tolerante; chat: exacta, tolerante;
 *   admin: exacta). Conducta nula: la fachada sólo junta las copias del reintento tolerante.
 * - `cascada`: todavía no está implementada.
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
import type { Facetas, FiltrosCatalogo, PaginaCatalogo, TextoBusqueda } from "../catalog";
import { terminosBusqueda } from "../catalogo-busqueda";
import type { OrdenCatalogo } from "../catalogo-url";
import { criterioDe } from "./destino";
import type { PlanBusqueda } from "./plan";

export type Superficie = "catalogo" | "autocompletar" | "chat" | "admin";
export type Politica = "legado" | "cascada";
export type Etapa = "sin-texto" | "codigo" | "plan" | "exacta" | "tolerante" | "vacio";

/** Filtros sin ningún campo de texto: el motor es el único que arma `texto`. */
export type FiltrosSinTexto = Omit<FiltrosCatalogo, "texto" | "busqueda" | "busquedaTolerante" | "planBusqueda">;

/** Los mismos filtros sin los campos de texto (todo lo demás pasa intacto). */
export function sinTexto(f: FiltrosCatalogo): FiltrosSinTexto {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { texto, busqueda, busquedaTolerante, planBusqueda, ...resto } = f;
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
  politica: Politica;
  /** Flag `busqueda-ia` (kill switch): apagado, nunca hay etapa `plan` ni se pide plan. */
  conPlan: boolean;
  /** Perezoso: sólo se invoca si la secuencia lo necesita. Punto único de adquisición del plan. */
  planDe?: (consultaCruda: string) => Promise<PlanBusqueda | null>;
  /** Contar el total (por defecto: sólo el catálogo). */
  conteo?: boolean;
  /** Leer también las facetas de cada etapa (sólo la página del catálogo). */
  conFacetas?: boolean;
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
  ms: number;
}

/** Reglas de la política `legado` por superficie (tabla declarativa; reproduce lo que hacían las rutas). */
interface ReglasLegado {
  /** `si-sin-codigo`: sólo si la consulta no parece un código. */
  plan: "no" | "si" | "si-sin-codigo";
  /** Con plan usable la secuencia se corta ahí: sin exacta ni tolerante (catálogo). */
  planSolo: boolean;
  tolerante: boolean;
  conteo: boolean;
  /** Etapas cuyo error pasa a la siguiente en vez de propagarse. */
  degradaEn: readonly Etapa[];
  /** Etapas que leen los atributos estructurados de cada producto ("todas" = todas). */
  estructuradosEn: "todas" | readonly Etapa[];
}

const LEGADO: Record<Superficie, ReglasLegado> = {
  catalogo: { plan: "si", planSolo: true, tolerante: true, conteo: true, degradaEn: ["tolerante"], estructuradosEn: "todas" },
  // El autocompletar clásico (`getCatalogo`) nunca pidió los atributos estructurados: sólo su camino con plan.
  autocompletar: { plan: "si-sin-codigo", planSolo: false, tolerante: true, conteo: false, degradaEn: ["plan", "tolerante"], estructuradosEn: ["plan"] },
  chat: { plan: "no", planSolo: false, tolerante: true, conteo: false, degradaEn: ["tolerante"], estructuradosEn: "todas" },
  admin: { plan: "no", planSolo: false, tolerante: false, conteo: false, degradaEn: [], estructuradosEn: "todas" },
};

const admiteParecido = (termino: string) => termino.length >= 4;

interface EntradaPlan {
  politica: Politica;
  superficie: Superficie;
  consulta: string;
  conPlan: boolean;
}

/** ¿Esta búsqueda va a necesitar el plan? Evita pedirlo (y gastar) cuando ninguna etapa lo usa. */
export function necesitaPlan({ politica, superficie, consulta, conPlan }: EntradaPlan): boolean {
  if (politica !== "legado" || !conPlan || terminosBusqueda(consulta).length === 0) return false;
  const { plan } = LEGADO[superficie];
  return plan === "si" || (plan === "si-sin-codigo" && !pareceCodigo(consulta));
}

/**
 * Las etapas que corre una búsqueda, en orden (pura). `plan` es el plan ya resuelto (o null);
 * un plan de intención "codigo" cuenta como sin plan.
 */
export function etapasDe({ politica, superficie, consulta, plan, conPlan }: EntradaPlan & { plan: PlanBusqueda | null }): Etapa[] {
  if (politica !== "legado") throw new Error("La política cascada todavía no está implementada.");
  const terminos = terminosBusqueda(consulta);
  if (terminos.length === 0) return ["sin-texto"];
  const reglas = LEGADO[superficie];
  const etapas: Etapa[] = [];
  const conPlanUsable = conPlan && !!plan && plan.intencion !== "codigo" && necesitaPlan({ politica, superficie, consulta, conPlan });
  if (conPlanUsable) {
    etapas.push("plan");
    if (reglas.planSolo) return etapas;
  }
  etapas.push("exacta");
  if (reglas.tolerante && terminos.some(admiteParecido)) etapas.push("tolerante");
  return etapas;
}

const nombreDe = (err: unknown) => (err instanceof Error ? err.name : "desconocido");

export async function buscar(p: PedidoBuscar, o: OpcionesBuscar, d: DepsMotor): Promise<ResultadoBuscar> {
  if (o.politica !== "legado") throw new Error("La política cascada todavía no está implementada.");
  const ahora = d.ahora ?? Date.now;
  const inicio = ahora();
  const q = p.consulta?.trim() ?? "";
  const reglas = LEGADO[o.superficie];
  const entrada: EntradaPlan = { politica: o.politica, superficie: o.superficie, consulta: q, conPlan: o.conPlan };

  // Perezoso: sólo si alguna etapa lo va a usar. Un plan que falla es "sin plan", no un error.
  let plan: PlanBusqueda | null = null;
  if (o.planDe && necesitaPlan(entrada)) {
    try {
      plan = await o.planDe(q);
    } catch {
      plan = null;
    }
  }

  const conteo = o.conteo ?? reglas.conteo;
  const filtrosDe = (etapa: Etapa): FiltrosCatalogo => {
    const base: FiltrosCatalogo = { ...p.filtros };
    if (reglas.estructuradosEn !== "todas" && !reglas.estructuradosEn.includes(etapa)) delete base.atributosEstructurados;
    let texto: TextoBusqueda | undefined;
    if (etapa === "exacta") texto = { q };
    else if (etapa === "tolerante") texto = { q, tolerante: true };
    else if (etapa === "plan") texto = { q, plan: criterioDe(plan!, { categorias: base.categorias ?? [], atributos: base.atributos ?? [] }) };
    return texto ? { ...base, texto } : base;
  };

  const intentos: Etapa[] = [];
  let primera: { filtros: FiltrosCatalogo; pagina: PaginaCatalogo; facetas?: Facetas } | null = null;
  let ultimoError: unknown;
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
    ms: ahora() - inicio,
  });

  for (const etapa of etapasDe({ ...entrada, plan })) {
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
      if (!reglas.degradaEn.includes(etapa)) throw err;
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

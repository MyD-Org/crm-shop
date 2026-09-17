/**
 * Motor de cuotas (modelo Tiendanube). Puro y sin imports de server: corre en
 * el server (pedido, oferta) y en el cliente (card, carrito) con las mismas
 * funciones, así lo que se muestra es lo que se congela.
 *
 * Depende SÓLO de un monto base (precio final unitario, total del carrito o
 * total del pedido). Nunca del producto.
 *
 * Reglas (spec cuotas-configurables, dominio 2):
 * - La config del CRM sólo RESTRINGE: sin plan del proveedor, la opción no existe.
 * - Sin interés efectivo = marcada en el CRM Y tasa del proveedor 0 (doble llave).
 * - Vigencia por fecha en hora Argentina, desde/hasta inclusive.
 * - Datos mal formados se ignoran, nunca tiran.
 */
import type {
  Escalon,
  MedioDePago,
  OfertaCuotas,
  OpcionConfigurada,
  OpcionCuotas,
  OpcionOfertada,
  PlanDeCuotas,
  PlanPedido,
} from "./pagos/cuotas-tipos";

const CUOTAS_MIN = 2;
const CUOTAS_MAX = 24;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Redondeo hacia arriba al centavo, tolerante al ruido de coma flotante. */
const ceil2 = (n: number) => Math.ceil(Number((n * 100).toFixed(6))) / 100;

const finito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const nullableFinito = (n: unknown): n is number | null => n === null || finito(n);

/** Fecha de hoy en Argentina como "YYYY-MM-DD". */
export function hoyArgentina(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

// ---------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------

function opcionValida(o: OpcionConfigurada): boolean {
  return (
    Number.isInteger(o.cuotas) &&
    o.cuotas >= CUOTAS_MIN &&
    o.cuotas <= CUOTAS_MAX &&
    finito(o.montoMinimo) &&
    o.montoMinimo >= 0 &&
    (o.vigenteDesde === null || (typeof o.vigenteDesde === "string" && FECHA.test(o.vigenteDesde))) &&
    (o.vigenteHasta === null || (typeof o.vigenteHasta === "string" && FECHA.test(o.vigenteHasta)))
  );
}

function planValido(p: PlanDeCuotas): boolean {
  return (
    Number.isInteger(p.cuotas) &&
    p.cuotas >= 1 &&
    finito(p.tasaPct) &&
    p.tasaPct >= 0 &&
    nullableFinito(p.cftPct) &&
    nullableFinito(p.teaPct) &&
    nullableFinito(p.montoMin) &&
    nullableFinito(p.montoMax)
  );
}

/** Comparación de strings YYYY-MM-DD: el orden lexicográfico es el cronológico. */
const vigente = (o: OpcionConfigurada, hoy: string) =>
  (o.vigenteDesde === null || o.vigenteDesde <= hoy) &&
  (o.vigenteHasta === null || hoy <= o.vigenteHasta);

/** ¿`a` le gana a `b` para el mismo medio+cuotas? Sin interés, luego menor mínimo. */
const leGana = (a: OpcionOfertada, b: OpcionOfertada) =>
  a.sinInteres !== b.sinInteres ? a.sinInteres : a.montoMinimo < b.montoMinimo;

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

/**
 * Cruza la config del CRM con los planes reales y la fecha de referencia. El
 * resultado es compacto y serializable: viaja como prop al cliente.
 */
export function armarOferta(
  medios: MedioDePago[],
  opciones: OpcionConfigurada[],
  planes: PlanDeCuotas[],
  hoy: string,
): OfertaCuotas {
  // Plan por proveedor+medio+cuotas. Si llegara repetido, la tasa más alta:
  // mejor no prometer de menos.
  const planPorClave = new Map<string, PlanDeCuotas>();
  for (const p of planes) {
    if (!p || !planValido(p)) continue;
    const clave = `${p.proveedor}|${p.medio}|${p.cuotas}`;
    const previo = planPorClave.get(clave);
    if (!previo || p.tasaPct > previo.tasaPct) planPorClave.set(clave, p);
  }

  const resultado: OfertaCuotas["medios"] = [];
  const activos = medios.filter((m) => m && m.activo).sort((a, b) => a.orden - b.orden);

  for (const medio of activos) {
    const porCuotas = new Map<number, OpcionOfertada>();
    for (const o of opciones) {
      if (!o || o.medioId !== medio.id || !o.activo || !opcionValida(o) || !vigente(o, hoy)) continue;
      const p = planPorClave.get(`${medio.proveedor}|${medio.codigo}|${o.cuotas}`);
      if (!p) continue;
      const ofertada: OpcionOfertada = {
        cuotas: o.cuotas,
        sinInteres: o.sinInteres === true && p.tasaPct === 0,
        montoMinimo: o.montoMinimo,
        tasaPct: p.tasaPct,
        cftPct: p.cftPct,
        teaPct: p.teaPct,
        montoMin: p.montoMin,
        montoMax: p.montoMax,
      };
      const previa = porCuotas.get(o.cuotas);
      if (!previa || leGana(ofertada, previa)) porCuotas.set(o.cuotas, ofertada);
    }
    if (porCuotas.size === 0) continue;
    resultado.push({
      codigo: medio.codigo,
      nombre: medio.nombre,
      orden: medio.orden,
      opciones: [...porCuotas.values()].sort((a, b) => a.cuotas - b.cuotas),
    });
  }

  return { medios: resultado, hoy, planesFetchedAt: null, configVersion: null };
}

const dentroDelRango = (o: OpcionOfertada, base: number) =>
  (o.montoMin ?? 0) <= base && (o.montoMax === null || base <= o.montoMax);

/** Opciones disponibles para un monto base, en orden de medio y cuotas. */
export function opcionesPara(base: number, oferta: OfertaCuotas): OpcionCuotas[] {
  if (!finito(base) || base <= 0) return [];
  const salida: OpcionCuotas[] = [];
  for (const medio of oferta.medios) {
    for (const o of medio.opciones) {
      if (o.montoMinimo > base || !dentroDelRango(o, base)) continue;
      const total = o.sinInteres ? round2(base) : round2(base * (1 + o.tasaPct / 100));
      salida.push({
        medio: medio.codigo,
        medioNombre: medio.nombre,
        cuotas: o.cuotas,
        montoCuota: round2(total / o.cuotas),
        total,
        precioContado: round2(base),
        cftPct: o.cftPct,
        teaPct: o.teaPct,
        sinInteres: o.sinInteres,
      });
    }
  }
  return salida;
}

/**
 * Una única mejor opción: la de más cuotas sin interés; si no hay, la de menor
 * cuota. Empate: menor CFT (null al final), luego el orden de entrada (que
 * `opcionesPara` ya da por orden de medio).
 */
export function mejorOpcion(opciones: OpcionCuotas[]): OpcionCuotas | null {
  const sinInteres = opciones.filter((o) => o.sinInteres);
  const pool = sinInteres.length > 0 ? sinInteres : opciones;
  let mejor: OpcionCuotas | null = null;
  for (const o of pool) {
    if (!mejor) {
      mejor = o;
      continue;
    }
    const principal =
      sinInteres.length > 0 ? mejor.cuotas - o.cuotas : o.montoCuota - mejor.montoCuota;
    if (principal < 0) {
      mejor = o;
    } else if (principal === 0 && cftMenor(o.cftPct, mejor.cftPct)) {
      mejor = o;
    }
  }
  return mejor;
}

/** Estrictamente menor; null cuenta como el peor. */
function cftMenor(a: number | null, b: number | null): boolean {
  if (a === null) return false;
  if (b === null) return true;
  return a < b;
}

/** Máximo de cuotas global y por medio. Sin opciones: 1 (siempre hay 1 pago). */
export function maxCuotas(opciones: OpcionCuotas[]): {
  global: number;
  porMedio: Record<string, number>;
} {
  let global = 1;
  const porMedio: Record<string, number> = {};
  for (const o of opciones) {
    global = Math.max(global, o.cuotas);
    porMedio[o.medio] = Math.max(porMedio[o.medio] ?? 1, o.cuotas);
  }
  return { global, porMedio };
}

/**
 * Próximo escalón ("Te faltan $X para N cuotas sin interés").
 *
 * Primero sin interés efectivo con más cuotas que el mejor sin interés actual;
 * si no hay, con interés que supere el máximo actual. En ambos: el de menor
 * monto mínimo, empate → más cuotas. Se ignora el rango del proveedor salvo que
 * el máximo del proveedor haga el escalón inalcanzable.
 */
export function proximoEscalon(base: number, oferta: OfertaCuotas): Escalon | null {
  if (!finito(base) || base < 0) return null;
  const disponibles = opcionesPara(base, oferta);
  const k = disponibles.reduce((max, o) => (o.sinInteres ? Math.max(max, o.cuotas) : max), 0);
  const { global } = maxCuotas(disponibles);

  const candidatas = oferta.medios
    .flatMap((m) => m.opciones)
    .filter((o) => o.montoMinimo > base && !(o.montoMax !== null && o.montoMax < o.montoMinimo));

  const elegir = (pool: OpcionOfertada[]) =>
    pool.reduce<OpcionOfertada | null>((mejor, o) => {
      if (!mejor) return o;
      if (o.montoMinimo !== mejor.montoMinimo) return o.montoMinimo < mejor.montoMinimo ? o : mejor;
      return o.cuotas > mejor.cuotas ? o : mejor;
    }, null);

  const escalon =
    elegir(candidatas.filter((o) => o.sinInteres && o.cuotas > k)) ??
    elegir(candidatas.filter((o) => o.cuotas > global));

  if (!escalon) return null;
  return {
    cuotas: escalon.cuotas,
    sinInteres: escalon.sinInteres,
    montoMinimo: escalon.montoMinimo,
    faltante: ceil2(escalon.montoMinimo - base),
  };
}

/**
 * Plan a congelar en el pedido, sobre el total real. `null` si no hay oferta
 * leíble: el pedido queda con cuotas_max null y la ruta de pago aplica el clamp
 * legacy (decisión registrada: no bloquear ventas por falta de datos).
 */
export function planPedido(total: number, oferta: OfertaCuotas | null): PlanPedido | null {
  if (!oferta) return null;
  const opciones = opcionesPara(total, oferta);
  const { global, porMedio } = maxCuotas(opciones);
  return {
    version: "v1",
    configVersion: oferta.configVersion,
    planesFetchedAt: oferta.planesFetchedAt,
    hoy: oferta.hoy,
    totalBase: total,
    cuotasMax: global,
    maxPorMedio: porMedio,
    opciones,
  };
}

/**
 * Motor de cuotas v2 (config por proveedor). Puro y sin imports de server:
 * corre en el server (pedido, oferta) y en el cliente (card, carrito) con las
 * mismas funciones, así lo que se muestra es lo que se congela.
 *
 * Depende SÓLO de un monto base (precio final unitario, total del carrito o
 * total del pedido). Nunca del producto.
 *
 * Reglas (decisión cuotas-v2):
 * - El CRM configura por proveedor escalones {cuotasMax, montoMinimo}. Para un
 *   monto M, el máximo es el mayor cuotasMax con montoMinimo <= M; ninguno → 1.
 * - El proveedor define qué cantidades existen y su tasa. Sin interés = tasa 0.
 * - Se muestran TODAS las cantidades del snapshot <= máximo (y dentro del rango
 *   de montos del proveedor).
 * - Datos mal formados se ignoran, nunca tiran.
 */
import type {
  Escalon,
  EscalonCuotas,
  OfertaCuotas,
  OpcionCuotas,
  OpcionOfertada,
  PlanDeCuotas,
  PlanPedido,
  ProveedorConfigurado,
} from "./pagos/cuotas-tipos";

const CUOTAS_MIN = 1;
const CUOTAS_MAX = 24;

/** Proveedor del Brick: el único que hoy congela plan en el pedido. */
export const PROVEEDOR_PEDIDO = "mercadopago";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Redondeo hacia arriba al centavo, tolerante al ruido de coma flotante. */
const ceil2 = (n: number) => Math.ceil(Number((n * 100).toFixed(6))) / 100;

const finito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const nullableFinito = (n: unknown): n is number | null => n === null || finito(n);

type EscalonOferta = OfertaCuotas["proveedores"][number]["escalones"][number];
type ProveedorOferta = OfertaCuotas["proveedores"][number];

// ---------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------

function escalonValido(e: EscalonCuotas | EscalonOferta): boolean {
  return (
    !!e &&
    Number.isInteger(e.cuotasMax) &&
    e.cuotasMax >= CUOTAS_MIN &&
    e.cuotasMax <= CUOTAS_MAX &&
    finito(e.montoMinimo) &&
    e.montoMinimo >= 0
  );
}

function planValido(p: PlanDeCuotas): boolean {
  return (
    !!p &&
    Number.isInteger(p.cuotas) &&
    p.cuotas >= CUOTAS_MIN &&
    p.cuotas <= CUOTAS_MAX &&
    finito(p.tasaPct) &&
    p.tasaPct >= 0 &&
    nullableFinito(p.cftPct) &&
    nullableFinito(p.teaPct) &&
    nullableFinito(p.montoMin) &&
    nullableFinito(p.montoMax)
  );
}

// ---------------------------------------------------------------------------
// Escalones
// ---------------------------------------------------------------------------

/** Máximo de cuotas para un monto: mayor cuotasMax alcanzado. Ninguno → 1 pago. */
export function cuotasMaxPara(base: number, escalones: readonly (EscalonCuotas | EscalonOferta)[]): number {
  if (!finito(base) || base < 0) return 1;
  let max = 1;
  for (const e of escalones) {
    if (escalonValido(e) && e.montoMinimo <= base) max = Math.max(max, e.cuotasMax);
  }
  return max;
}

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

/**
 * Cruza la config del CRM con los planes reales. Por proveedor junta las marcas
 * (visa, master) por cantidad de cuotas con la tasa MÁS ALTA (no prometer de
 * menos) y el rango de montos más restrictivo. "1 pago" no es una opción: existe
 * siempre. El resultado es compacto y serializable: viaja como prop al cliente.
 */
export function armarOferta(proveedores: ProveedorConfigurado[], planes: PlanDeCuotas[]): OfertaCuotas {
  const porProveedor = new Map<string, Map<number, OpcionOfertada>>();
  for (const p of planes) {
    if (!planValido(p) || p.cuotas < 2) continue;
    let porCuotas = porProveedor.get(p.proveedor);
    if (!porCuotas) porProveedor.set(p.proveedor, (porCuotas = new Map()));
    const previa = porCuotas.get(p.cuotas);
    if (!previa) {
      porCuotas.set(p.cuotas, {
        cuotas: p.cuotas,
        sinInteres: p.tasaPct === 0,
        tasaPct: p.tasaPct,
        cftPct: p.cftPct,
        teaPct: p.teaPct,
        montoMin: p.montoMin,
        montoMax: p.montoMax,
      });
      continue;
    }
    if (p.tasaPct > previa.tasaPct) {
      previa.tasaPct = p.tasaPct;
      previa.sinInteres = false;
      previa.cftPct = p.cftPct;
      previa.teaPct = p.teaPct;
    }
    if (p.montoMin !== null) previa.montoMin = previa.montoMin === null ? p.montoMin : Math.max(previa.montoMin, p.montoMin);
    if (p.montoMax !== null) previa.montoMax = previa.montoMax === null ? p.montoMax : Math.min(previa.montoMax, p.montoMax);
  }

  const resultado = proveedores
    .filter((p) => p && p.activo)
    .sort((a, b) => a.orden - b.orden)
    .map(
      (p): ProveedorOferta => ({
        proveedor: p.proveedor,
        nombre: p.nombre,
        orden: p.orden,
        escalones: (Array.isArray(p.escalones) ? p.escalones : [])
          .filter(escalonValido)
          .map((e) => ({ cuotasMax: e.cuotasMax, montoMinimo: e.montoMinimo }))
          .sort((a, b) => a.montoMinimo - b.montoMinimo),
        opciones: [...(porProveedor.get(p.proveedor)?.values() ?? [])].sort((a, b) => a.cuotas - b.cuotas),
      }),
    );

  return { proveedores: resultado, planesFetchedAt: null, configVersion: null };
}

const dentroDelRango = (o: OpcionOfertada, base: number) =>
  (o.montoMin ?? 0) <= base && (o.montoMax === null || base <= o.montoMax);

function opcionesProveedor(base: number, p: ProveedorOferta): OpcionCuotas[] {
  if (!finito(base) || base <= 0) return [];
  const tope = cuotasMaxPara(base, p.escalones);
  const salida: OpcionCuotas[] = [];
  for (const o of p.opciones) {
    if (o.cuotas > tope || !dentroDelRango(o, base)) continue;
    const total = o.sinInteres ? round2(base) : round2(base * (1 + o.tasaPct / 100));
    salida.push({
      proveedor: p.proveedor,
      proveedorNombre: p.nombre,
      cuotas: o.cuotas,
      montoCuota: round2(total / o.cuotas),
      total,
      precioContado: round2(base),
      cftPct: o.cftPct,
      teaPct: o.teaPct,
      sinInteres: o.sinInteres,
    });
  }
  return salida;
}

/** Opciones disponibles para un monto base, en orden de proveedor y cuotas. */
export function opcionesPara(base: number, oferta: OfertaCuotas): OpcionCuotas[] {
  return oferta.proveedores.flatMap((p) => opcionesProveedor(base, p));
}

/**
 * Una única mejor opción: la mayor cantidad sin interés; si no hay, la mayor
 * cantidad con la cuota más baja en esa cantidad. Empate: menor CFT (null al
 * final), luego el orden de entrada.
 */
export function mejorOpcion(opciones: OpcionCuotas[]): OpcionCuotas | null {
  const sinInteres = opciones.filter((o) => o.sinInteres);
  const pool = sinInteres.length > 0 ? sinInteres : opciones;
  let mejor: OpcionCuotas | null = null;
  for (const o of pool) {
    if (!mejor || o.cuotas > mejor.cuotas) {
      mejor = o;
      continue;
    }
    if (o.cuotas < mejor.cuotas) continue;
    if (o.montoCuota < mejor.montoCuota || (o.montoCuota === mejor.montoCuota && cftMenor(o.cftPct, mejor.cftPct))) {
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

/** Mayor cantidad de cuotas entre las opciones. Sin opciones: 1 (siempre hay 1 pago). */
export function maxCuotas(opciones: OpcionCuotas[]): number {
  return opciones.reduce((max, o) => Math.max(max, o.cuotas), 1);
}

/**
 * Próximo escalón ("Te faltan $X para hasta N cuotas").
 *
 * Por proveedor: escalones con monto mínimo mayor a la base que habiliten una
 * cantidad del snapshot mayor a la que ya se ofrece. Se informa esa cantidad
 * efectiva (lo que el comprador va a ver), no el cuotasMax crudo. Entre
 * proveedores: el de menor monto mínimo, empate → más cuotas.
 */
export function proximoEscalon(base: number, oferta: OfertaCuotas): Escalon | null {
  if (!finito(base) || base < 0) return null;
  let elegido: Escalon | null = null;

  for (const p of oferta.proveedores) {
    const actual = maxCuotas(opcionesProveedor(base, p));
    for (const e of p.escalones) {
      if (e.montoMinimo <= base) continue;
      const cuotas = maxCuotas(opcionesProveedor(e.montoMinimo, p));
      if (cuotas <= actual) continue;
      if (
        !elegido ||
        e.montoMinimo < elegido.montoMinimo ||
        (e.montoMinimo === elegido.montoMinimo && cuotas > elegido.cuotas)
      ) {
        elegido = { cuotas, montoMinimo: e.montoMinimo, faltante: ceil2(e.montoMinimo - base) };
      }
    }
  }
  return elegido;
}

/**
 * Plan a congelar en el pedido, sobre el total real. `null` si no hay oferta
 * leíble: el pedido queda con cuotas_max null y la ruta de pago aplica el clamp
 * legacy (decisión registrada: no bloquear ventas por falta de datos).
 *
 * El máximo sale de los escalones del proveedor (el Brick sólo acepta un
 * `maxInstallments`); las opciones son las que se mostraron. Proveedor no
 * configurado → 1 pago.
 */
export function planPedido(
  total: number,
  oferta: OfertaCuotas | null,
  proveedor: string = PROVEEDOR_PEDIDO,
): PlanPedido | null {
  if (!oferta) return null;
  const p = oferta.proveedores.find((x) => x.proveedor === proveedor);
  return {
    version: "v2",
    proveedor,
    configVersion: oferta.configVersion,
    planesFetchedAt: oferta.planesFetchedAt,
    totalBase: total,
    cuotasMax: p ? cuotasMaxPara(total, p.escalones) : 1,
    opciones: p ? opcionesProveedor(total, p) : [],
  };
}

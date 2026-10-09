/**
 * Planes de cuotas que Mercado Pago ofrece para una tarjeta. SOLO servidor: se consultan con el Access
 * Token de la cuenta (no con la public key del navegador), así lo que se muestra al comprador y lo que
 * se acepta al cobrar salen de la MISMA consulta.
 *
 * `GET /v1/payment_methods/installments?amount=<precio de 1 pago>&bin=<6-8 dígitos>` (o
 * `&payment_method_id=visa` antes de cargar la tarjeta: ahí MP responde una entrada por emisor).
 *
 * Reglas de oferta (decisión legal conservadora):
 * - Sólo tarjeta de CRÉDITO y sólo N >= 2 (el pago único lo ofrece la tienda).
 * - Con interés (`installment_rate > 0`) se ofrece SOLO si MP informa CFT y TEA (etiqueta
 *   `"CFT_169,00%|TEA_130,00%"`, formato verificado contra una respuesta real).
 * - Tasa 0: cuotas sin interés de MP a cargo del vendedor; total = precio de 1 pago.
 *
 * Fail-closed: si MP no responde (timeout de 3 s, error HTTP, JSON ilegible) el resultado es
 * `{ ok: false }` y quien llama NO ofrece ni acepta cuotas con interés. Nunca lanza.
 */
import { credencialesMercadoPago } from "./credenciales";

const API = "https://api.mercadopago.com/v1/payment_methods/installments";
const TIMEOUT_MS = 3_000;
const CACHE_MS = 60_000;
const CACHE_MAX = 500;

/** Una cantidad de cuotas que ofrece Mercado Pago para la tarjeta. */
export interface PlanMP {
  cuotas: number;
  montoCuota: number;
  /** Lo que paga el comprador en total (con el interés, si lo hay). */
  total: number;
  /** `installment_rate` de MP: % de recargo sobre el precio. 0 = sin interés a cargo del vendedor. */
  tasaPct: number;
  /** Como lo informa MP, sin el %: "169,00". null sólo en planes sin interés. */
  cft: string | null;
  tea: string | null;
  conInteres: boolean;
}

/** Planes de un método de pago (marca) y emisor. */
export interface PlanesMP {
  /** `payment_method_id` de MP (visa, master, amex…). */
  metodoPagoId: string;
  emisor: { id: string; nombre: string } | null;
  logo: string | null;
  /** Ordenados por cuotas, sólo N >= 2. */
  planes: PlanMP[];
}

export type ResultadoPlanesMP =
  /** `entrada` null = MP respondió pero no hay planes de crédito para esa tarjeta (débito, prepaga…). */
  | { ok: true; entrada: PlanesMP | null }
  | { ok: false };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const esNumero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const RE_CFT_TEA = /^CFT_(\d+(?:,\d+)?)%\|TEA_(\d+(?:,\d+)?)%$/;

/** CFT y TEA de las `labels` de un `payer_cost`. null si no vienen las dos cifras. */
export function parsearCftTea(labels: unknown): { cft: string; tea: string } | null {
  if (!Array.isArray(labels)) return null;
  for (const l of labels) {
    const m = typeof l === "string" ? RE_CFT_TEA.exec(l.trim()) : null;
    if (m) return { cft: m[1], tea: m[2] };
  }
  return null;
}

function parsearPlan(p: unknown): PlanMP | null {
  if (!esObjeto(p)) return null;
  const { installments: cuotas, installment_rate: tasa, installment_amount: montoCuota, total_amount: total } = p;
  if (!esNumero(cuotas) || !Number.isInteger(cuotas) || cuotas < 2) return null;
  if (!esNumero(tasa) || tasa < 0 || !esNumero(montoCuota) || montoCuota <= 0 || !esNumero(total) || total <= 0) {
    return null;
  }
  if (tasa === 0) return { cuotas, montoCuota, total, tasaPct: 0, cft: null, tea: null, conInteres: false };
  const cftTea = parsearCftTea(p.labels);
  if (!cftTea) return null;
  return { cuotas, montoCuota, total, tasaPct: tasa, ...cftTea, conInteres: true };
}

/** Respuesta de `/installments` → entradas de tarjeta de crédito con sus planes. Puro; nunca lanza. */
export function parsearPlanesMP(json: unknown): PlanesMP[] {
  if (!Array.isArray(json)) return [];
  const salida: PlanesMP[] = [];
  for (const e of json) {
    if (!esObjeto(e) || e.payment_type_id !== "credit_card") continue;
    const metodoPagoId = texto(e.payment_method_id);
    if (!metodoPagoId) continue;
    const emisor = esObjeto(e.issuer) ? e.issuer : null;
    const emisorId = emisor && (esNumero(emisor.id) ? String(emisor.id) : texto(emisor.id));
    const emisorNombre = emisor && texto(emisor.name);
    // Una por cantidad de cuotas (gana la primera), ascendentes.
    const porCuotas = new Map<number, PlanMP>();
    for (const crudo of Array.isArray(e.payer_costs) ? e.payer_costs : []) {
      const p = parsearPlan(crudo);
      if (p && !porCuotas.has(p.cuotas)) porCuotas.set(p.cuotas, p);
    }
    const planes = [...porCuotas.values()].sort((a, b) => a.cuotas - b.cuotas);
    salida.push({
      metodoPagoId,
      emisor: emisorId && emisorNombre ? { id: emisorId, nombre: emisorNombre } : null,
      logo: emisor ? texto(emisor.secure_thumbnail) : null,
      planes,
    });
  }
  return salida;
}

/**
 * Sin BIN, MP responde una entrada por emisor (muchas con sólo 1 pago): la de referencia es la que
 * más cuotas ofrece. Con BIN hay una sola entrada.
 */
export function planesDeReferencia(entradas: readonly PlanesMP[]): PlanesMP | null {
  let mejor: PlanesMP | null = null;
  for (const e of entradas) if (!mejor || e.planes.length > mejor.planes.length) mejor = e;
  return mejor;
}

const cache = new Map<string, { vence: number; resultado: ResultadoPlanesMP }>();

/** Para tests. */
export function limpiarCachePlanesMP(): void {
  cache.clear();
}

export interface ConsultaPlanesMP {
  /** Precio de 1 pago del pedido. */
  amount: number;
  /** 6 a 8 primeros dígitos de la tarjeta. */
  bin?: string;
  /** Sin tarjeta cargada: planes de referencia de una marca (p. ej. "visa"). */
  paymentMethodId?: string;
  /** Cuenta del pedido (slug de la sucursal): los planes son los de ESA cuenta de Mercado Pago. */
  cuenta: string;
}

/** Planes de MP para una tarjeta (o una marca de referencia). Caché de 60 s por cuenta; nunca lanza. */
export async function consultarPlanesMP(
  q: ConsultaPlanesMP,
  deps: { fetch?: typeof fetch } = {},
): Promise<ResultadoPlanesMP> {
  const { accessToken, cuentaId } = credencialesMercadoPago(q.cuenta);
  if (!accessToken || !esNumero(q.amount) || q.amount <= 0) return { ok: false };
  let filtro: string;
  if (q.bin !== undefined) {
    if (!/^\d{6,8}$/.test(q.bin)) return { ok: false };
    filtro = `bin=${q.bin}`;
  } else if (q.paymentMethodId !== undefined && /^[a-z]+$/.test(q.paymentMethodId)) {
    filtro = `payment_method_id=${q.paymentMethodId}`;
  } else {
    return { ok: false };
  }

  const clave = `${cuentaId}|${q.amount}|${filtro}`;
  const ahora = Date.now();
  const enCache = cache.get(clave);
  if (enCache && enCache.vence > ahora) return enCache.resultado;

  let resultado: ResultadoPlanesMP;
  try {
    const res = await (deps.fetch ?? fetch)(`${API}?amount=${q.amount}&${filtro}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[mercadopago-planes] HTTP ${res.status}`);
      return { ok: false };
    }
    resultado = { ok: true, entrada: planesDeReferencia(parsearPlanesMP(await res.json())) };
  } catch (err) {
    // Sin el mensaje: puede traer la URL (con el BIN).
    console.error("[mercadopago-planes] sin respuesta:", (err as Error)?.name ?? "error");
    return { ok: false };
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(clave, { vence: ahora + CACHE_MS, resultado });
  return resultado;
}

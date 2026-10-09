/**
 * Llamadas del navegador para las cuotas del formulario de pago (rebanada 4 de
 * `cuotas-en-el-formulario`, design D1/D2):
 *
 * - `consultarOpcionesCuotas`: `POST /api/pedidos/[id]/cuotas` (sin efectos) con el BIN de la tarjeta
 *   cargada (Mercado Pago) o su marca (Payway); el servidor junta las sin interés de la tienda con los
 *   planes de Mercado Pago.
 * - `asegurarCuotasDelPedido`: antes de cobrar, si la opción elegida pide otras cuotas que las que el
 *   pedido tiene congeladas (N sin interés, o 1 para el pago único, las con interés, el débito y la
 *   cuenta de Mercado Pago), UN `POST /api/pedidos/[id]/medio` con el total visto. Se omite si ya
 *   coincide. El cobro igual lo revalida el servidor.
 * - `cambiarFormaDelPedido`: al pasar de pestaña (Mercado Pago) o de modalidad (Payway) en un medio con
 *   precios por forma de pago, UN `POST /api/pedidos/[id]/medio` con la forma: el servidor recotiza y
 *   vuelve a congelar total y forma. Cualquier cambio de forma deja el pedido en 1 pago.
 */
import type { OpcionesCuotasPedido } from "@/app/api/pedidos/[id]/cuotas/route";
import { hayQueRecongelar } from "./cuotas-formulario";
import { leerFormaCobro, type OpcionCobro } from "./pagos/opciones-cobro";

export type { OpcionesCuotasPedido };

type Fetcher = (url: string, init: RequestInit & { body: string }) => Promise<Response>;

const SIN_CONEXION = "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.";
const NO_SE_PUDO = "No pudimos actualizar las cuotas de su pedido. Inténtelo de nuevo.";
const NO_SE_PUDO_FORMA = "No pudimos actualizar la forma de pago de su pedido. Inténtelo de nuevo.";

/** Con qué tarjeta se consultan las cuotas: Mercado Pago manda el BIN; Payway, la marca (detectada o elegida). */
export interface ConsultaCuotas {
  bin?: string | null;
  marca?: string | null;
}

export async function consultarOpcionesCuotas(
  pedidoId: string,
  consulta: ConsultaCuotas,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<OpcionesCuotasPedido | null> {
  const res = await fetcher(`/api/pedidos/${encodeURIComponent(pedidoId)}/cuotas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(consulta.bin ? { bin: consulta.bin } : {}), ...(consulta.marca ? { marca: consulta.marca } : {}) }),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as OpcionesCuotasPedido | null;
  return json && Array.isArray(json.opciones) ? json : null;
}

export type ResultadoAsegurar =
  | { ok: true; cambio: boolean; cuotas: number | null; total: number; formaCobro?: OpcionCobro | null }
  | { ok: false; error: string };


export async function asegurarCuotasDelPedido(a: {
  pedidoId: string;
  pagoMetodo: string;
  /** Cuotas en las que tiene que quedar el pedido (`pedidoCuotas` de la opción). */
  cuotas: number;
  /**
   * Total que el comprador vio para esa opción: si el servidor recotiza otro, no cambia nada (409). Sin
   * él (no se pudieron consultar las opciones) el servidor no lo compara.
   */
  totalVisto?: number;
  actual: { cuotas: number | null; total: number; formaCobro?: OpcionCobro | null };
  /**
   * Forma de pago que se va a cobrar (solo con un pedido que ya tiene forma congelada). Siempre viaja
   * en el POST: sin ella el servidor volvería a la forma por defecto del medio.
   */
  forma?: OpcionCobro | null;
  fetcher?: Fetcher;
}): Promise<ResultadoAsegurar> {
  const forma = a.actual.formaCobro != null ? a.forma : undefined;
  if (!hayQueRecongelar(a.cuotas, a.actual.cuotas, forma, a.actual.formaCobro)) return { ok: true, cambio: false, ...a.actual };
  try {
    const res = await (a.fetcher ?? fetch)(`/api/pedidos/${encodeURIComponent(a.pedidoId)}/medio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagoMetodo: a.pagoMetodo,
        cuotas: a.cuotas,
        ...(forma ? { forma } : {}),
        ...(a.totalVisto !== undefined ? { totalVisto: a.totalVisto } : {}),
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      cuotas?: unknown;
      total?: unknown;
      formaCobro?: unknown;
      error?: unknown;
    } | null;
    if (!res.ok || !json) return { ok: false, error: typeof json?.error === "string" ? json.error : NO_SE_PUDO };
    return {
      ok: true,
      cambio: true,
      cuotas: typeof json.cuotas === "number" ? json.cuotas : null,
      total: typeof json.total === "number" ? json.total : (a.totalVisto ?? a.actual.total),
      ...(json.formaCobro !== undefined ? { formaCobro: leerFormaCobro(json.formaCobro) } : {}),
    };
  } catch {
    return { ok: false, error: SIN_CONEXION };
  }
}

/**
 * Cambia la forma de pago del pedido (pestaña o modalidad nueva): el servidor recotiza con la lista de
 * esa forma y vuelve a congelar total y forma, en 1 pago (cambiar de forma invalida las cuotas).
 * Un 409 (cobro en vuelo, pago en revisión) o 429 (demasiados cambios) devuelve el mensaje del
 * servidor, ya en usted, y el pedido queda como estaba.
 */
export async function cambiarFormaDelPedido(a: {
  pedidoId: string;
  pagoMetodo: string;
  forma: OpcionCobro;
  fetcher?: Fetcher;
}): Promise<{ ok: true; total: number; cuotas: number | null; formaCobro: OpcionCobro | null } | { ok: false; error: string }> {
  try {
    const res = await (a.fetcher ?? fetch)(`/api/pedidos/${encodeURIComponent(a.pedidoId)}/medio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoMetodo: a.pagoMetodo, forma: a.forma, cuotas: 1 }),
    });
    const json = (await res.json().catch(() => null)) as {
      cuotas?: unknown;
      total?: unknown;
      formaCobro?: unknown;
      error?: unknown;
    } | null;
    if (!res.ok || !json || typeof json.total !== "number") {
      return { ok: false, error: typeof json?.error === "string" ? json.error : NO_SE_PUDO_FORMA };
    }
    return {
      ok: true,
      total: json.total,
      cuotas: typeof json.cuotas === "number" ? json.cuotas : null,
      formaCobro: leerFormaCobro(json.formaCobro),
    };
  } catch {
    return { ok: false, error: SIN_CONEXION };
  }
}

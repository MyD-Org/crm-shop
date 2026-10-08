/**
 * Llamadas del navegador para las cuotas del formulario de pago (rebanada 4 de
 * `cuotas-en-el-formulario`, design D1/D2):
 *
 * - `consultarOpcionesCuotas`: `POST /api/pedidos/[id]/cuotas` (sin efectos) con el BIN de la tarjeta
 *   cargada; el servidor junta las sin interés de la tienda con los planes de Mercado Pago.
 * - `asegurarCuotasDelPedido`: antes de cobrar, si la opción elegida pide otras cuotas que las que el
 *   pedido tiene congeladas (N sin interés, o 1 para el pago único, las con interés, el débito y la
 *   cuenta de Mercado Pago), UN `POST /api/pedidos/[id]/medio` con el total visto. Se omite si ya
 *   coincide. El cobro igual lo revalida el servidor.
 */
import type { OpcionesCuotasPedido } from "@/app/api/pedidos/[id]/cuotas/route";
import { hayQueRecongelar } from "./cuotas-formulario";

export type { OpcionesCuotasPedido };

type Fetcher = (url: string, init: RequestInit & { body: string }) => Promise<Response>;

const SIN_CONEXION = "No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.";
const NO_SE_PUDO = "No pudimos actualizar las cuotas de su pedido. Inténtelo de nuevo.";

export async function consultarOpcionesCuotas(
  pedidoId: string,
  bin: string | null,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<OpcionesCuotasPedido | null> {
  const res = await fetcher(`/api/pedidos/${encodeURIComponent(pedidoId)}/cuotas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bin ? { bin } : {}),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as OpcionesCuotasPedido | null;
  return json && Array.isArray(json.opciones) ? json : null;
}

export type ResultadoAsegurar =
  | { ok: true; cambio: boolean; cuotas: number | null; total: number }
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
  actual: { cuotas: number | null; total: number };
  fetcher?: Fetcher;
}): Promise<ResultadoAsegurar> {
  if (!hayQueRecongelar(a.cuotas, a.actual.cuotas)) return { ok: true, cambio: false, ...a.actual };
  try {
    const res = await (a.fetcher ?? fetch)(`/api/pedidos/${encodeURIComponent(a.pedidoId)}/medio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagoMetodo: a.pagoMetodo, cuotas: a.cuotas, ...(a.totalVisto !== undefined ? { totalVisto: a.totalVisto } : {}) }),
    });
    const json = (await res.json().catch(() => null)) as { cuotas?: unknown; total?: unknown; error?: unknown } | null;
    if (!res.ok || !json) return { ok: false, error: typeof json?.error === "string" ? json.error : NO_SE_PUDO };
    return {
      ok: true,
      cambio: true,
      cuotas: typeof json.cuotas === "number" ? json.cuotas : null,
      total: typeof json.total === "number" ? json.total : (a.totalVisto ?? a.actual.total),
    };
  } catch {
    return { ok: false, error: SIN_CONEXION };
  }
}

import { upsertInstancia, PlataformaError, type Deps } from "@/lib/plataforma-cliente"
import { leerCursorProductos, guardarCursorProductos, type CursorProductos } from "@/lib/plataforma-proyeccion-repo"
import { leerProductosDesde, type FilaProducto } from "@/lib/plataforma-productos-fuente"
import type { TenantConfig } from "./tenants"

// Espejo `producto` en la plataforma (spec §2 "El espejo"): la clave de origen es alegra_id y el
// cursor es (synced_at, alegra_id): la sync estampa un único synced_at por lote, así que el id
// desempata. Backfill y stream son el mismo camino: con el cursor en epoch se empuja todo. Sólo un
// rechazo por producto (400 invalid_data o 422) se loguea y no frena el lote: el producto se vuelve
// a intentar cuando la sync lo toque de nuevo. Cualquier otro error (red/5xx, y también 401, 403,
// 404 spec_not_found, 409 mirror_write_forbidden: configuración rota) corta el lote: el cursor queda
// en la última fila procesada, la ruta informa ok:false y la próxima corrida retoma desde ahí.
export const LOTE_PRODUCTOS = 500

export function productoParaPlataforma(f: FilaProducto) {
  const stock = f.stock == null ? null : Number(f.stock)
  return {
    name: f.name, code: f.code ?? null, description: f.description ?? null, brand: f.brand ?? null,
    category_alegra_id: f.categoryAlegraId ?? null,
    status: f.status === "inactive" ? "inactive" : "active", alegra_status: f.alegraStatus ?? null,
    stock: stock != null && Number.isFinite(stock) ? stock : null,
    images: Array.isArray(f.images) ? (f.images as unknown[]).filter((i): i is string => typeof i === "string") : [],
  }
}

/** 400 invalid_data / 422: el dato de ESE producto no valida; el resto de los errores no son culpa del producto. */
function esRechazoDeProducto(err: unknown): err is PlataformaError {
  return err instanceof PlataformaError && ((err.status === 400 && err.code === "invalid_data") || err.status === 422)
}

export async function empujarProductos(t: TenantConfig, opts: { lote?: number; deps?: Deps } = {}): Promise<{ enviados: number; fallidos: number; cursor: CursorProductos; cortado: boolean }> {
  const inicial = await leerCursorProductos(t.id)
  let cursor = inicial
  const filas = await leerProductosDesde(t.id, cursor, opts.lote ?? LOTE_PRODUCTOS)
  let enviados = 0, fallidos = 0, cortado = false
  for (const f of filas) {
    try {
      await upsertInstancia(t, "producto", f.alegraId, { data: productoParaPlataforma(f) }, opts.deps ?? {})
      enviados++
    } catch (err) {
      if (esRechazoDeProducto(err)) {
        fallidos++
        console.warn(`[plataforma] producto rechazado tenant=${t.id} alegraId=${f.alegraId} ${err.code}: ${err.details.join("; ")}`)
      } else {
        console.warn(`[plataforma] corte del lote tenant=${t.id} en alegraId=${f.alegraId}: ${err instanceof Error ? err.message : "error"}`)
        cortado = true
        break
      }
    }
    cursor = { at: f.syncedAt, clave: f.alegraId }
  }
  if (cursor !== inicial) await guardarCursorProductos(t.id, cursor)
  return { enviados, fallidos, cursor, cortado }
}

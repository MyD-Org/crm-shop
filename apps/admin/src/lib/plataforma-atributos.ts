import { upsertInstancia, PlataformaError, type Deps } from "@/lib/plataforma-cliente"
import { getTenantByIdFromDb, plataformaConfigurada, type TenantConfig, type ModoPlataformaAtributos } from "@/lib/tenants"
import { leerProducto } from "@/lib/plataforma-productos-fuente"
import { productoParaPlataforma } from "@/lib/plataforma-productos"
import type { FilaAtributo, FuenteAtributo } from "@/lib/catalogo-atributos-repo"

// Escritura de atributos en la plataforma (contrato platform-apps/v1 §atributos_tecnicos). La
// precedencia manual > pdf > nombre la aplica la plataforma con meta.fuente; `reemplaza_fuente`
// borra las claves de esa misma fuente que no vinieron (la sync de Alegra con `nombre`).
// Nunca tira: un rechazo de schema (400) se loguea con el motivo y se devuelve 'rechazado'.

export type Valor = { n: number | null; t: string | null }

/** Concurrencia de los PATCH por producto: la sync trabaja con presupuesto de tiempo. */
export const CONCURRENCIA = 8

/** Corre `fn` sobre cada ítem con a lo sumo `limite` en vuelo; conserva el orden de resultados. */
async function enLotes<T, R>(items: readonly T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker))
  return out
}

export function datosDeFilas(filas: FilaAtributo[]): Record<string, Valor> {
  const out: Record<string, Valor> = {}
  for (const f of filas) out[f.clave] = { n: f.valorNum, t: f.valorTexto }
  return out
}

// Un error de DB cae a "off": para un tenant `on` tras el corte 0091 la escritura local apunta a la vista y falla
// fuerte (aceptado: la sync ya lo tolera y la ruta manual muestra el error).
/** Modo del tenant; `off` si no hay plataforma configurada o si leer el tenant falla (se loguea). */
export async function modoAtributosDe(tenantId: string): Promise<ModoPlataformaAtributos> {
  try {
    const t = await getTenantByIdFromDb(tenantId)
    if (!t || !plataformaConfigurada(t)) return "off"
    return t.plataformaAtributos
  } catch (err) {
    console.warn(`[plataforma] no se pudo leer el modo de atributos tenant=${tenantId}, se asume off: ${err instanceof Error ? err.message : "error"}`)
    return "off"
  }
}

function clasificar(t: TenantConfig, alegraId: string, fuente: FuenteAtributo, err: unknown): "rechazado" | "error" {
  const e = err instanceof PlataformaError ? err : null
  if (e && !e.reintentable) {
    console.warn(`[plataforma] atributos rechazados tenant=${t.id} alegraId=${alegraId} fuente=${fuente} ${e.code}: ${e.details.join("; ")}`)
    return "rechazado"
  }
  console.warn(`[plataforma] atributos sin escribir tenant=${t.id} alegraId=${alegraId} fuente=${fuente}: ${err instanceof Error ? err.message : "error"}`)
  return "error"
}

export async function escribirAtributosPlataforma(t: TenantConfig, alegraId: string, data: Record<string, Valor | null>, fuente: FuenteAtributo, opts: { reemplaza?: boolean; deps?: Deps } = {}): Promise<"ok" | "rechazado" | "error"> {
  const body = { data, meta: { fuente, ...(opts.reemplaza ? { reemplaza_fuente: true } : {}) } }
  const patch = () => upsertInstancia(t, "atributos_tecnicos", alegraId, body, opts.deps ?? {})
  try {
    await patch()
    return "ok"
  } catch (err) {
    // Producto recién creado por la sync: el espejo lo sube el cron, así que la plataforma todavía
    // no tiene el ancla. Se sube ese único producto y se reintenta una vez.
    if (err instanceof PlataformaError && err.status === 404 && err.code === "anchor_not_found") {
      try {
        const fila = await leerProducto(t.id, alegraId)
        if (!fila) {
          console.warn(`[plataforma] ancla faltante y sin fila local tenant=${t.id} alegraId=${alegraId}`)
          return clasificar(t, alegraId, fuente, err)
        }
        await upsertInstancia(t, "producto", alegraId, { data: productoParaPlataforma(fila) }, opts.deps ?? {})
        await patch()
        return "ok"
      } catch (err2) {
        console.warn(`[plataforma] el reintento tras subir el ancla falló tenant=${t.id} alegraId=${alegraId}`)
        return clasificar(t, alegraId, fuente, err2)
      }
    }
    return clasificar(t, alegraId, fuente, err)
  }
}

export interface ResultadoFilas { ok: number; rechazados: number; errores: number; filasOk: number }

/** Escribe un lote de filas (varias claves por producto) con concurrencia acotada. Devuelve conteos. */
export async function escribirFilasPlataforma(t: TenantConfig, filas: FilaAtributo[], fuente: FuenteAtributo, opts: { reemplaza?: boolean; deps?: Deps } = {}): Promise<ResultadoFilas> {
  const porProducto = new Map<string, FilaAtributo[]>()
  for (const f of filas) porProducto.set(f.alegraId, [...(porProducto.get(f.alegraId) ?? []), f])
  const r: ResultadoFilas = { ok: 0, rechazados: 0, errores: 0, filasOk: 0 }
  await enLotes([...porProducto], CONCURRENCIA, async ([alegraId, fs]) => {
    const res = await escribirAtributosPlataforma(t, alegraId, datosDeFilas(fs), fuente, opts)
    if (res === "ok") { r.ok++; r.filasOk += fs.length } else if (res === "rechazado") r.rechazados++; else r.errores++
  })
  return r
}

/** Un PATCH por producto con datos propios (la sync de nombre manda también los vacíos). */
export async function escribirProductosPlataforma(t: TenantConfig, items: { alegraId: string; data: Record<string, Valor | null> }[], fuente: FuenteAtributo, opts: { reemplaza?: boolean; deps?: Deps } = {}): Promise<{ ok: number; filasOk: number }> {
  const r = { ok: 0, filasOk: 0 }
  await enLotes(items, CONCURRENCIA, async (it) => {
    if ((await escribirAtributosPlataforma(t, it.alegraId, it.data, fuente, opts)) === "ok") { r.ok++; r.filasOk += Object.keys(it.data).length }
  })
  return r
}

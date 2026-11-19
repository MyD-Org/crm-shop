// Precios de las etiquetas de precio: se le piden al Shop del tenant para que sean EXACTAMENTE los
// de la card del catálogo (precio de lista online con IVA, medio destacado, campañas), sin duplicar
// esa lógica acá. Contrato CRM → Shop: POST {shop}/api/internal/etiquetas/precios, Bearer con el
// secreto del destino (`resolverDestinoShop`: SHOP_CRM_SECRET_<SLUG> o el par histórico), body
// `{ ids }`, respuesta `{ precios: { [alegraId]: PrecioEtiqueta } }`. Doc del contrato: repo
// MyD-Org/platform (crm-shop-base).
//
// El destino es SIEMPRE el principal del tenant de la sesión: nunca sale de un input.

import type { PrecioEtiqueta } from "@/lib/etiquetas/trabajos"
import { resolverDestinoShop } from "@/lib/shop-destino"
import { leerFilaShop } from "@/lib/shop-destino-db"

const PATH = "/api/internal/etiquetas/precios"
export const PRECIOS_TIMEOUT_MS = 15_000
/** Mismo tope que el Shop (y que "Agregar todos los de la marca"). */
export const MAX_IDS_PRECIOS = 1000

export type ResultadoPreciosShop =
  | { ok: true; precios: Record<string, PrecioEtiqueta> }
  | { ok: false; motivo: "sin-shop" | "error" }

const esNumero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/** Valida lo que contesta el Shop: descarta entradas mal formadas en vez de imprimir basura. */
export function leerPrecios(cuerpo: unknown, ids: readonly string[]): Record<string, PrecioEtiqueta> | null {
  const crudo = (cuerpo as { precios?: unknown } | null)?.precios
  if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) return null
  const out: Record<string, PrecioEtiqueta> = {}
  for (const id of ids) {
    const p = (crudo as Record<string, unknown>)[id] as { precioLista?: unknown; precioMedio?: unknown } | undefined
    if (!p || typeof p !== "object") continue
    const m = p.precioMedio as { nombre?: unknown; rotulo?: unknown; precio?: unknown } | null | undefined
    out[id] = {
      precioLista: esNumero(p.precioLista) ? p.precioLista : null,
      precioMedio:
        m && typeof m === "object" && esNumero(m.precio) && typeof m.nombre === "string"
          ? { nombre: m.nombre, rotulo: typeof m.rotulo === "string" ? m.rotulo : `con ${m.nombre}`, precio: m.precio }
          : null,
    }
  }
  return out
}

export async function preciosEtiquetasDelShop(tenantId: string, ids: readonly string[]): Promise<ResultadoPreciosShop> {
  const destino = resolverDestinoShop(tenantId, await leerFilaShop(tenantId), process.env)
  if (!destino?.urlInterna || !destino.secret) return { ok: false, motivo: "sin-shop" }
  if (ids.length === 0) return { ok: true, precios: {} }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PRECIOS_TIMEOUT_MS)
  try {
    const res = await fetch(`${destino.urlInterna}${PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${destino.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) {
      console.warn(`[etiquetas/precios] el Shop respondió ${res.status}`)
      return { ok: false, motivo: "error" }
    }
    const precios = leerPrecios(await res.json().catch(() => null), ids)
    if (!precios) {
      console.warn("[etiquetas/precios] el Shop respondió sin el JSON esperado")
      return { ok: false, motivo: "error" }
    }
    return { ok: true, precios }
  } catch (err) {
    console.warn(`[etiquetas/precios] pedido al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    return { ok: false, motivo: "error" }
  } finally {
    clearTimeout(timer)
  }
}

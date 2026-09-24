import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraDocumentoItems, alegraWebhookAvisos } from "@/db/schema"
import { EVENTOS_STOCK } from "./alegra"
import { encolar } from "./alegra-stock-cola"
import { idDe, objeto, tokenValido, tokenWebhook, type Obj } from "./alegra-webhook-comun"

// Avisos (webhooks) de Alegra sobre facturas, compras e ítems → cola de re-lectura de ítems.
//
// El aviso es SÓLO un disparador (decisión 7 del change `webhooks-stock-alegra`): de él salen
// los ids de los ítems tocados, nunca el stock. El valor lo pone el drenador leyendo cada ítem
// con GET /items/{id} (lib/alegra-stock-cola.ts).
//
// Forma observada en la prueba real (2026-09-24): `{"subject","message":{"invoice"|"bill"|
// "item":{...}}}`, sin firma ni headers propios.
// - invoice: `status` open/draft/void e `items[{id,…}]` con los ítems VIGENTES (uno quitado en
//   una edición no aparece). `delete-invoice` llega con `items: []`.
// - bill: `state` (no status), proveedor en `client`; `delete-bill` sí trae ítems.
// - item: el ítem completo (con `inventory.availableQuantity`, que NO se usa).
// Por eso hay un índice documento→ítems (alegra_documento_items): se re-lee la unión de lo
// que el documento tenía y lo que tiene ahora.
//
// Nunca se guarda ni se loguea cliente, proveedor, montos ni cantidades: sólo ids.

export type EventoStock = (typeof EVENTOS_STOCK)[number]

export function esEventoStock(x: string): x is EventoStock {
  return (EVENTOS_STOCK as readonly string[]).includes(x)
}

/** Token de la URL de los avisos de stock de un tenant. Distinto del de contactos. */
export function tokenWebhookStock(
  tenantId: string,
  secreto: string | undefined = process.env.ALEGRA_WEBHOOK_SECRET,
): string | null {
  return tokenWebhook("alegra-stock", tenantId, secreto)
}

export function tokenWebhookStockValido(
  tenantId: string,
  token: string,
  secreto: string | undefined = process.env.ALEGRA_WEBHOOK_SECRET,
): boolean {
  return tokenValido("alegra-stock", tenantId, token, secreto)
}

/** Ruta pública de los avisos (sin el host). La usan la ruta y el script de suscripciones. */
export function rutaWebhookStock(tenantId: string, evento: EventoStock, token: string): string {
  return `/api/webhooks/alegra/stock/${encodeURIComponent(tenantId)}/${evento}/${token}`
}

// ── Lectura defensiva del cuerpo ──

export type TipoDocumento = "invoice" | "bill"

export interface AvisoStock {
  tipo: TipoDocumento | "item"
  /** Id de la factura/compra; null para los avisos de ítems. */
  docId: string | null
  /** status (invoice) / state (bill); null si no vino o es un ítem. */
  estado: string | null
  /** Ids de ítems del aviso, sin repetidos. */
  itemIds: string[]
}

function tipoDe(evento: EventoStock): AvisoStock["tipo"] {
  return evento.endsWith("-invoice") ? "invoice" : evento.endsWith("-bill") ? "bill" : "item"
}

/** El documento del aviso: bajo su nombre (en `message`, `data` o la raíz), o `data`/la raíz mismos. */
function documento(raiz: Obj, clave: string): Obj | null {
  const message = objeto(raiz.message)
  const data = objeto(raiz.data)
  for (const c of [objeto(message?.[clave]), objeto(data?.[clave]), objeto(raiz[clave])]) if (c) return c
  for (const c of [data, message, raiz]) if (c && idDe(c)) return c
  return null
}

function idsDeItems(doc: Obj): string[] {
  const items = Array.isArray(doc.items) ? doc.items : []
  const ids = items.map((it) => idDe(objeto(it))).filter((x): x is string => x !== null)
  return [...new Set(ids)]
}

/** `null` = sin documento reconocible (p. ej. el POST de verificación `{}`). */
export function leerAvisoStock(evento: EventoStock, payload: unknown): AvisoStock | null {
  const raiz = objeto(payload)
  if (!raiz) return null
  const tipo = tipoDe(evento)
  const doc = documento(raiz, tipo)
  const id = idDe(doc)
  if (!doc || !id) return null
  if (tipo === "item") return { tipo, docId: null, estado: null, itemIds: [id] }
  const est = tipo === "invoice" ? (doc.status ?? doc.state) : (doc.state ?? doc.status)
  return {
    tipo,
    docId: id,
    estado: typeof est === "string" && est.trim() ? est.trim() : null,
    itemIds: idsDeItems(doc),
  }
}

// ── Registrar el aviso (antes de responder) ──

export type AccionAvisoStock = "encolado" | "borrador" | "sin_id" | "sin_indice" | "error"

export interface ResultadoAvisoStock {
  accion: AccionAvisoStock
  docId?: string
  /** Ids del aviso (para el log). */
  items: number
  encolados: number
}

/** Un borrador no mueve stock: al abrirse llega un `edit-invoice` con status open. */
const esBorrador = (estado: string | null | undefined) => estado?.toLowerCase() === "draft"

/**
 * Registra un aviso en UNA transacción: índice documento→ítems, cola y contador del día. No
 * habla con Alegra. Si la base falla, tira (la ruta responde 500).
 */
export async function registrarAviso(
  tenantId: string,
  evento: EventoStock,
  payload: unknown,
): Promise<ResultadoAvisoStock> {
  const aviso = leerAvisoStock(evento, payload)
  if (!aviso) return { accion: "sin_id", items: 0, encolados: 0 }

  return getDb().transaction(async (tx) => {
    // Contador de avisos por día (hora de Buenos Aires) y evento: para notar que dejaron de llegar.
    await tx
      .insert(alegraWebhookAvisos)
      .values({ tenantId, dia: sql`(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`, evento, cantidad: 1 })
      .onConflictDoUpdate({
        target: [alegraWebhookAvisos.tenantId, alegraWebhookAvisos.dia, alegraWebhookAvisos.evento],
        set: { cantidad: sql`${alegraWebhookAvisos.cantidad} + 1`, ultimoAt: sql`now()` },
      })

    if (aviso.tipo === "item") {
      const encolados = await encolar(tx, tenantId, aviso.itemIds, evento)
      return { accion: "encolado", items: aviso.itemIds.length, encolados }
    }

    const docId = aviso.docId as string
    const tipo = aviso.tipo
    const clave = and(
      eq(alegraDocumentoItems.tenantId, tenantId),
      eq(alegraDocumentoItems.tipo, tipo),
      eq(alegraDocumentoItems.alegraDocId, docId),
    )
    const [previo] = await tx
      .select({ itemIds: alegraDocumentoItems.itemIds, estado: alegraDocumentoItems.estado })
      .from(alegraDocumentoItems)
      .where(clave)
      .for("update")
    const union = [...new Set([...(previo?.itemIds ?? []), ...aviso.itemIds])]
    const base = { docId, items: aviso.itemIds.length }

    if (evento.startsWith("delete-")) {
      if (previo) await tx.delete(alegraDocumentoItems).where(clave)
      // Borrar un borrador no devuelve nada: nunca descontó.
      if (esBorrador(aviso.estado ?? previo?.estado)) return { ...base, accion: "borrador", encolados: 0 }
      if (union.length === 0) return { ...base, accion: "sin_indice", encolados: 0 }
      return { ...base, accion: "encolado", encolados: await encolar(tx, tenantId, union, evento) }
    }

    // new/edit: el índice queda con los ítems ACTUALES (uno quitado se re-lee en ESTE aviso).
    await tx
      .insert(alegraDocumentoItems)
      .values({ tenantId, tipo, alegraDocId: docId, itemIds: aviso.itemIds, estado: aviso.estado, actualizadoAt: sql`now()` })
      .onConflictDoUpdate({
        target: [alegraDocumentoItems.tenantId, alegraDocumentoItems.tipo, alegraDocumentoItems.alegraDocId],
        set: { itemIds: sql`excluded.item_ids`, estado: sql`excluded.estado`, actualizadoAt: sql`now()` },
      })
    // Un borrador no mueve stock: se ignora si nace así o si ya lo era. Pasar una abierta a
    // borrador SÍ devuelve el stock (visto en prod el 2026-09-24), y sin historial no se sabe
    // si estaba abierta: en esos casos se re-lee. Anulada (void) o un `state` desconocido: se
    // re-lee (es inocuo).
    if (esBorrador(aviso.estado) && (evento.startsWith("new-") || (previo && esBorrador(previo.estado)))) {
      return { ...base, accion: "borrador", encolados: 0 }
    }
    return { ...base, accion: "encolado", encolados: await encolar(tx, tenantId, union, evento) }
  })
}

// ── Suscripciones (las usa scripts/alegra-webhooks-stock.ts) ──

export interface SuscripcionAlegra {
  id: string
  event: string
  url: string
}

/** Ruta de stock de ESTE tenant (no las de contactos ni las de otro tenant). */
export function esSuscripcionStock(tenantId: string, s: SuscripcionAlegra): boolean {
  return (
    (EVENTOS_STOCK as readonly string[]).includes(s.event) &&
    s.url.includes(`/api/webhooks/alegra/stock/${encodeURIComponent(tenantId)}/`)
  )
}

/** Alegra guarda la URL sin esquema: se compara sin él. */
const mismaUrl = (a: string, b: string) => a.replace(/^https?:\/\//i, "") === b.replace(/^https?:\/\//i, "")

export interface PlanSuscripciones {
  /** Eventos cuya suscripción vigente ya existe. */
  vigentes: EventoStock[]
  /** Las que hay que crear. */
  faltan: { event: EventoStock; url: string }[]
  /** Suscripciones de stock del tenant con OTRA url (otro host o secreto viejo). */
  viejas: SuscripcionAlegra[]
}

/**
 * Qué falta crear y qué quedó desactualizado, a partir de las suscripciones actuales de la
 * cuenta. Re-ejecutar con todo al día no crea nada.
 */
export function planSuscripcionesStock(
  tenantId: string,
  baseUrl: string,
  token: string,
  actuales: SuscripcionAlegra[],
): PlanSuscripciones {
  const nuestras = actuales.filter((s) => esSuscripcionStock(tenantId, s))
  const plan = EVENTOS_STOCK.map((event) => ({ event, url: `${baseUrl}${rutaWebhookStock(tenantId, event, token)}` }))
  const existe = (p: { event: string; url: string }) => nuestras.some((s) => s.event === p.event && mismaUrl(s.url, p.url))
  return {
    vigentes: plan.filter(existe).map((p) => p.event),
    faltan: plan.filter((p) => !existe(p)),
    viejas: nuestras.filter((s) => !plan.some((p) => p.event === s.event && mismaUrl(s.url, p.url))),
  }
}

/** La URL con el token tapado: alcanza para reconocerla sin filtrar el secreto. */
export function enmascararUrlStock(url: string): string {
  return url.replace(/(\/api\/webhooks\/alegra\/stock\/[^/]+\/[^/]+\/)([^/?#]+)/, (_, pre: string, tok: string) => `${pre}${tok.slice(0, 4)}…`)
}

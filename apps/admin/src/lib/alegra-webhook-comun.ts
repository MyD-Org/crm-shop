import { createHmac } from "node:crypto"
import { secureCompare } from "./secure-compare"

// Piezas comunes de los receptores de avisos (webhooks) de Alegra: contactos
// (lib/alegra-contacts-webhook.ts) y stock (lib/alegra-stock-webhook.ts).
//
// - Autenticación: Alegra no firma los avisos ni manda headers propios. Cada URL lleva un token
//   derivado con HMAC de ALEGRA_WEBHOOK_SECRET y del DOMINIO del flujo + el tenant: el token de
//   contactos no abre la ruta de stock ni al revés. Se compara en tiempo constante.
// - Cuerpo: se lee a la defensiva, con tope de tamaño, como JSON o como formulario.
// - Logs: nunca valores del cuerpo (las facturas y los contactos traen datos de clientes). La
//   primera vez por (flujo, tenant, evento) y por instancia se loguean las CLAVES, sin valores.

export type DominioWebhook = "alegra-contactos" | "alegra-stock"

/** Largo mínimo del secreto: uno corto se adivina y abre la escritura del espejo. */
const SECRETO_MIN = 32

/**
 * Token de la URL: HMAC-SHA256(ALEGRA_WEBHOOK_SECRET, "<dominio>:<tenant>") en hex, 32
 * caracteres. `null` si el secreto no está configurado o es corto: sin secreto la ruta rechaza
 * todo (falla cerrada).
 */
export function tokenWebhook(
  dominio: DominioWebhook,
  tenantId: string,
  secreto: string | undefined = process.env.ALEGRA_WEBHOOK_SECRET,
): string | null {
  if (!secreto || secreto.length < SECRETO_MIN) return null
  // Hex y 32 caracteres (128 bits): Alegra rechaza la URL de la suscripción con "La URL
  // ingresada no es válida" con el token en base64url (trae "_" y "-"). Probado 2026-09-23.
  return createHmac("sha256", secreto).update(`${dominio}:${tenantId}`).digest("hex").slice(0, 32)
}

export function tokenValido(
  dominio: DominioWebhook,
  tenantId: string,
  token: string,
  secreto: string | undefined = process.env.ALEGRA_WEBHOOK_SECRET,
): boolean {
  const esperado = tokenWebhook(dominio, tenantId, secreto)
  if (!esperado || !token) return false
  return secureCompare(token, esperado)
}

/** Tope del cuerpo: un aviso real pesa pocos KB; más que esto no se parsea. */
const CUERPO_MAX_BYTES = 1024 * 1024

/**
 * Cuerpo como JSON; si no lo es, como formulario (no se sabe cómo lo manda cada cuenta).
 * Vacío, ilegible o más grande que `maxBytes` → `null`.
 */
export async function leerCuerpo(req: Request, maxBytes = CUERPO_MAX_BYTES): Promise<unknown> {
  const texto = await textoConTope(req, maxBytes)
  if (!texto?.trim()) return null
  try {
    return JSON.parse(texto)
  } catch {
    return Object.fromEntries(new URLSearchParams(texto))
  }
}

async function textoConTope(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return null
  const declarado = Number(req.headers.get("content-length"))
  if (Number.isFinite(declarado) && declarado > maxBytes) return null
  const reader = req.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      partes.push(value)
    }
  } catch {
    return null
  }
  const junto = new Uint8Array(total)
  let off = 0
  for (const p of partes) {
    junto.set(p, off)
    off += p.byteLength
  }
  return new TextDecoder().decode(junto)
}

export type Obj = Record<string, unknown>

export function objeto(v: unknown): Obj | null {
  if (typeof v === "string") {
    // Hay integraciones que mandan el objeto como texto JSON dentro del cuerpo.
    const t = v.trim()
    if (!t.startsWith("{")) return null
    try {
      return objeto(JSON.parse(t))
    } catch {
      return null
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
}

/** Ids de Alegra son numéricos; se acepta algo razonable y nada que pueda romper una URL. */
export function idDe(o: Obj | null): string | null {
  const v = o?.id
  const id = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : ""
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/**
 * Claves del cuerpo SIN valores: las de primer nivel y, para las que son objeto, las de
 * adentro ("message.client"). Sirve para descubrir el formato sin loguear datos personales.
 */
export function clavesDelPayload(payload: unknown): string[] {
  const raiz = objeto(payload)
  if (!raiz) return [Array.isArray(payload) ? "(lista)" : `(${typeof payload})`]
  const out: string[] = []
  for (const [k, v] of Object.entries(raiz)) {
    const hijo = objeto(v)
    out.push(hijo ? `${k}{${Object.keys(hijo).join(",")}}` : k)
  }
  return out
}

const clavesYaLogueadas = new Set<string>()

/** Loguea las claves del cuerpo la primera vez por (prefijo, tenant, evento) en esta instancia. */
export function loguearClavesUnaVez(prefijo: string, tenantId: string, evento: string, payload: unknown): void {
  const k = `${prefijo}:${tenantId}:${evento}`
  if (clavesYaLogueadas.has(k)) return
  clavesYaLogueadas.add(k)
  console.log(`${prefijo} tenant=${tenantId} evento=${evento} claves=${clavesDelPayload(payload).join(" ")}`)
}

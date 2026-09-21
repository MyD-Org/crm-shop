import { createR2, type R2Client, type R2Config } from "./r2"

// Bucket PÚBLICO de fotos del catálogo (`shop-media`), separado del de comprobantes.
//
// Son dos buckets con credenciales distintas A PROPÓSITO: en `crm-portal` viven comprobantes de
// pago de clientes reales. Una sola llave para los dos convierte cualquier error de armado de key
// en este código en un error que toca datos sensibles.
//
// Por eso ESTE módulo expone `getShopMediaR2()` en vez de agregarle un parámetro a `getR2()`:
// `getR2` se mockea con aridad cero en los tests de integración de comprobantes, así que sumarle
// un argumento los dejaría pasando en verde mientras devuelven el cliente del bucket privado.
// Una función nueva no puede confundirse con la vieja.

const REQUIRED_ENV = ["R2_SHOP_MEDIA_ACCESS_KEY_ID", "R2_SHOP_MEDIA_SECRET_ACCESS_KEY", "R2_SHOP_MEDIA_BUCKET"] as const

export interface ShopMediaConfig extends R2Config {
  /** Base pública desde donde la tienda sirve las fotos. SIN barra final. */
  publicUrl: string
}

let configWarned = false

/**
 * Las credenciales propias del bucket público, o null si falta alguna.
 *
 * `accountId` y `region` se comparten con el bucket de comprobantes (son de la cuenta, no del
 * bucket); lo que NO se comparte es el par de llaves.
 */
export function shopMediaConfig(env: Record<string, string | undefined> = process.env): ShopMediaConfig | null {
  const accountId = env.R2_SHOP_MEDIA_ACCOUNT_ID ?? env.R2_ACCOUNT_ID
  const publicUrl = env.R2_SHOP_MEDIA_PUBLIC_URL
  const values = REQUIRED_ENV.map((name) => env[name])

  if (accountId && publicUrl && values.every((v) => typeof v === "string" && v.length > 0)) {
    const [accessKeyId, secretAccessKey, bucket] = values as [string, string, string]
    return {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      region: env.R2_REGION ?? "auto",
      publicUrl: publicUrl.replace(/\/+$/, ""),
    }
  }

  if (!configWarned) {
    configWarned = true
    const missing = [
      ...(accountId ? [] : ["R2_SHOP_MEDIA_ACCOUNT_ID o R2_ACCOUNT_ID"]),
      ...(publicUrl ? [] : ["R2_SHOP_MEDIA_PUBLIC_URL"]),
      ...REQUIRED_ENV.filter((name) => !env[name]),
    ]
    console.error(`[shop-media] config incompleta (faltan ${missing.join(", ")}): carga de fotos deshabilitada`)
  }
  return null
}

let cached: R2Client | null | undefined

/** Cliente del bucket público, o null si no está configurado. NUNCA el de comprobantes. */
export function getShopMediaR2(): R2Client | null {
  if (cached !== undefined) return cached
  const cfg = shopMediaConfig()
  cached = cfg ? createR2(cfg) : null
  return cached
}

/** Sólo para tests: descarta el cliente memoizado. */
export function resetShopMediaR2(): void {
  cached = undefined
  configWarned = false
}

const TENANT_ID_RE = /^[a-z0-9-]+$/
const ALEGRA_ID_RE = /^[A-Za-z0-9_-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Los anchos que se generan por foto. El primero es el que se usa de miniatura. */
export const ANCHOS_FOTO = [320, 800, 1600] as const
export type AnchoFoto = (typeof ANCHOS_FOTO)[number]

export function esAnchoValido(w: number): w is AnchoFoto {
  return (ANCHOS_FOTO as readonly number[]).includes(w)
}

/**
 * Key de una foto: `productos/{tenant}/{alegraId}/{uuid}-{ancho}.webp`.
 *
 * El uuid es por FOTO, no por variante: las tres medidas de la misma foto lo comparten, que es lo
 * que permite borrarlas juntas. Nunca va el nombre del archivo original.
 */
export function fotoKey(tenantId: string, alegraId: string, id: string, ancho: number): string {
  if (!TENANT_ID_RE.test(tenantId)) throw new Error(`tenantId inválido para key de R2: ${JSON.stringify(tenantId)}`)
  if (!ALEGRA_ID_RE.test(alegraId)) throw new Error(`alegraId inválido para key de R2: ${JSON.stringify(alegraId)}`)
  if (!UUID_RE.test(id)) throw new Error(`id inválido para key de R2: ${JSON.stringify(id)}`)
  if (!esAnchoValido(ancho)) throw new Error(`ancho inválido para key de R2: ${ancho}`)
  return `productos/${tenantId}/${alegraId}/${id}-${ancho}.webp`
}

/**
 * URL pública de una foto, compuesta al LEER.
 *
 * En la base se guarda la key, nunca la URL: hoy la base pública es un `pub-*.r2.dev` que Cloudflare
 * marca como no apto para producción, y el día que se mueva a un dominio propio el cambio tiene que
 * ser una variable de entorno y no una migración de datos.
 */
/**
 * Base pública de las fotos, o null.
 *
 * Aparte de `shopMediaConfig()` A PROPÓSITO: para COMPONER una url sólo hace falta el dominio, no
 * las credenciales. Atarlas dejaba al servidor sin poder emitir las fotos que ya tiene guardadas
 * en cualquier entorno donde no estén las llaves de subida — tests incluidos.
 */
export function basePublicaFotos(env: Record<string, string | undefined> = process.env): string | null {
  const base = env.R2_SHOP_MEDIA_PUBLIC_URL?.trim()
  return base ? base.replace(/\/+$/, "") : null
}

export function urlPublicaFoto(key: string, base: string | null = basePublicaFotos()): string | null {
  return base ? `${base}/${key}` : null
}

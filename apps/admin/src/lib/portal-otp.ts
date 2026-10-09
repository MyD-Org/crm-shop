/**
 * Código de acceso al portal del cliente, con estado en el SERVIDOR (tabla `portal_otps`, 0075).
 *
 * Antes el código, su vencimiento y el contador de intentos viajaban dentro de la cookie
 * sellada `portal-otp`. Como el servidor no guardaba nada, reenviar la cookie original dejaba el
 * contador siempre en cero: 10 minutos y un millón de combinaciones alcanzaban para forzarlo.
 *
 * Las reglas, que no se relajan:
 *  1. Se guarda un HMAC del código, nunca el código. Quien lea la base no puede usarlo.
 *  2. Los intentos se cuentan en el MISMO UPDATE que lee el hash: no hay carrera ni forma de
 *     "no aceptar" el contador desde el cliente.
 *  3. Un código vale una sola vez (`consumed_at`) y 10 minutos.
 *
 * SOLO servidor.
 */

import { createHmac, randomInt, timingSafeEqual } from "node:crypto"
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { portalOtps } from "@/db/schema"
import { SESSION_SECRET } from "@/lib/session-secret"

/** Vigencia del código. */
export const OTP_TTL_MS = 10 * 60 * 1000
/** Intentos de verificación por código antes de quemarlo. */
export const MAX_OTP_ATTEMPTS = 5

/**
 * Clave del HMAC: `OTP_SECRET` si está cargada; si no, `SESSION_SECRET`. Para el CRM eso no
 * abre nada nuevo: quien tenga `SESSION_SECRET` ya puede sellar una `portal-session` directa,
 * así que forjar hashes de códigos no le agrega nada. Una clave propia igual es mejor (se
 * rota aparte): basta con cargar `OTP_SECRET` en el entorno.
 */
function claveHmac(): string {
  return process.env.OTP_SECRET?.trim() || SESSION_SECRET
}

export function hashCodigo(tenantId: string, identifier: string, code: string): string {
  return createHmac("sha256", claveHmac()).update(`${tenantId}:${identifier}:${code}`).digest("hex")
}

function hashesIguales(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/** Código de 6 dígitos con RNG criptográfico (no Math.random), con padding. */
export function generarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

export interface OtpEmitido {
  /** Lo único que viaja en la cookie. */
  id: string
  /** El código en claro: va al email y a nada más (salvo `devCode` fuera de prod). */
  code: string
  expiresAt: Date
}

/**
 * Emite un código nuevo para (tenant, identificador). Los anteriores del mismo identificador
 * se borran: un solo código vivo por persona, el último que pidió. De paso se barren los
 * vencidos hace más de un día de todo el tenant (mantenimiento oportunista, sin cron).
 */
export async function emitirOtp(input: {
  tenantId: string
  identifier: string
  codigocliente: string
  now?: Date
}): Promise<OtpEmitido> {
  const db = getDb()
  const now = input.now ?? new Date()
  const code = generarCodigo()
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS)

  await db
    .delete(portalOtps)
    .where(
      and(
        eq(portalOtps.tenantId, input.tenantId),
        or(
          eq(portalOtps.identifier, input.identifier),
          lt(portalOtps.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        ),
      ),
    )

  const [fila] = await db
    .insert(portalOtps)
    .values({
      tenantId: input.tenantId,
      identifier: input.identifier,
      codigocliente: input.codigocliente,
      codeHash: hashCodigo(input.tenantId, input.identifier, code),
      expiresAt,
    })
    .returning({ id: portalOtps.id })

  return { id: fila.id, code, expiresAt }
}

export type ResultadoOtp =
  | { ok: true; identifier: string; codigocliente: string }
  /** No hay código vivo con ese id (nunca existió, ya se usó o es de otro tenant). */
  | { ok: false; motivo: "sin_otp" }
  | { ok: false; motivo: "vencido" }
  /** Se agotaron los intentos: el código queda inutilizable, hay que pedir otro. */
  | { ok: false; motivo: "agotado" }
  | { ok: false; motivo: "incorrecto"; restantes: number }

/**
 * Un intento de verificación. Consume un intento SIEMPRE que el código esté vivo, acierte o
 * no, en un único UPDATE atómico; si acierta, consume el código.
 */
export async function intentarOtp(input: {
  id: string
  tenantId: string
  code: string
  now?: Date
}): Promise<ResultadoOtp> {
  const db = getDb()
  const now = input.now ?? new Date()

  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, motivo: "sin_otp" }

  // Lee el hash e incrementa el contador en la misma sentencia: dos requests en paralelo
  // con el mismo id nunca ven el mismo valor de `intentos`.
  const [vivo] = await db
    .update(portalOtps)
    .set({ intentos: sql`${portalOtps.intentos} + 1` })
    .where(
      and(
        eq(portalOtps.id, input.id),
        eq(portalOtps.tenantId, input.tenantId),
        isNull(portalOtps.consumedAt),
        gt(portalOtps.expiresAt, now),
        lt(portalOtps.intentos, MAX_OTP_ATTEMPTS),
      ),
    )
    .returning({
      codeHash: portalOtps.codeHash,
      intentos: portalOtps.intentos,
      identifier: portalOtps.identifier,
      codigocliente: portalOtps.codigocliente,
    })

  if (!vivo) return motivoDeRechazo(input.id, input.tenantId, now)

  const esperado = hashCodigo(input.tenantId, vivo.identifier, input.code)
  if (!hashesIguales(esperado, vivo.codeHash)) {
    const restantes = MAX_OTP_ATTEMPTS - vivo.intentos
    return restantes <= 0 ? { ok: false, motivo: "agotado" } : { ok: false, motivo: "incorrecto", restantes }
  }

  // Un solo uso: si otro request lo consumió entre el UPDATE de arriba y éste, pierde.
  const [consumido] = await db
    .update(portalOtps)
    .set({ consumedAt: now })
    .where(and(eq(portalOtps.id, input.id), isNull(portalOtps.consumedAt)))
    .returning({ id: portalOtps.id })
  if (!consumido) return { ok: false, motivo: "sin_otp" }

  return { ok: true, identifier: vivo.identifier, codigocliente: vivo.codigocliente }
}

/** Para el mensaje al usuario: por qué el UPDATE no encontró un código vivo. No gasta intentos. */
async function motivoDeRechazo(id: string, tenantId: string, now: Date): Promise<ResultadoOtp> {
  const [fila] = await getDb()
    .select({ consumedAt: portalOtps.consumedAt, expiresAt: portalOtps.expiresAt, intentos: portalOtps.intentos })
    .from(portalOtps)
    .where(and(eq(portalOtps.id, id), eq(portalOtps.tenantId, tenantId)))
  if (!fila || fila.consumedAt) return { ok: false, motivo: "sin_otp" }
  if (fila.expiresAt <= now) return { ok: false, motivo: "vencido" }
  return { ok: false, motivo: "agotado" }
}

// Verificación en dos pasos del backoffice: estado en la base y en la cookie de sesión.
//
// Obligatoria para TODOS los usuarios (operator, admin y superadmin): decisión de la usuaria,
// 2026-11-01. Nadie la desactiva por su cuenta; si alguien pierde el celular, un admin la
// restablece desde Usuarios y en el próximo login la vuelve a dar de alta.
//
// Flujo del login (ver /api/admin/auth/login y /api/admin/auth/2fa/*):
//   1. Contraseña OK.
//      - Con 2FA dado de alta → sesión PENDIENTE modo "verificar".
//      - Sin 2FA → sesión PENDIENTE modo "alta" (se le muestra el QR).
//   2. Código correcto → sesión completa con mfa = "ok".
//
// Una sesión pendiente NO tiene `userId`: todo lo que mira `session.userId` (guard, rutas viejas)
// la trata como "sin sesión". Vence a los 10 minutos.
//
// Los intentos de código se cuentan en el servidor (Redis vía permitirAsync, por usuario), no
// en la cookie: reenviar una cookie vieja no reinicia el contador.
import type { IronSession } from "iron-session"
import QRCode from "qrcode"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import type { AdminSessionData } from "@/lib/admin-session"
import { permitirAsync } from "@/lib/rate-limit"
import {
  descifrarSecreto,
  generarCodigosRespaldo,
  hashCodigoRespaldo,
  pareceCodigoRespaldo,
  uriOtpauth,
  verificarTotp,
} from "@/lib/admin-totp"

export const PENDIENTE_VIGENCIA_MS = 10 * 60 * 1000
export const MAX_INTENTOS_2FA = 5
export const VENTANA_INTENTOS_2FA_MS = 15 * 60 * 1000

export type ModoPendiente = "verificar" | "alta"

export interface Pendiente2fa {
  userId: string
  tenantId: string
  modo: ModoPendiente
  /** Epoch ms: vencimiento. */
  hasta: number
  /** Epoch ms: emisión (se compara con sessions_revoked_before). */
  emitida: number
  /** Sólo modo "alta": secreto nuevo, cifrado, todavía sin guardar en la base. */
  secretoEnc?: string
}

type UsuarioSesion = { id: string; name: string; email: string; role: string }

/** Convierte la cookie en una sesión completa (después de contraseña + 2FA). */
export async function abrirSesionCompleta(
  session: IronSession<AdminSessionData>,
  user: UsuarioSesion,
  tenantId: string,
) {
  session.mfaPendiente = undefined
  session.userId = user.id
  session.name = user.name
  session.email = user.email
  session.role = user.role as AdminSessionData["role"]
  session.tenantId = tenantId
  session.issuedAt = Date.now()
  session.mfa = "ok"
  await session.save()
}

/** Deja la cookie en estado pendiente: SIN userId, sólo lo necesario para el segundo paso. */
export async function abrirSesionPendiente(
  session: IronSession<AdminSessionData>,
  userId: string,
  tenantId: string,
  modo: ModoPendiente,
  secretoEnc?: string,
) {
  const ahora = Date.now()
  session.userId = undefined as unknown as string
  session.name = undefined as unknown as string
  session.email = undefined as unknown as string
  session.role = undefined as unknown as AdminSessionData["role"]
  session.tenantId = undefined as unknown as string
  session.issuedAt = undefined
  session.mfa = undefined
  session.mfaPendiente = { userId, tenantId, modo, hasta: ahora + PENDIENTE_VIGENCIA_MS, emitida: ahora, secretoEnc }
  await session.save()
}

/** Pendiente vigente del modo pedido y del tenant del host, o null. */
export function pendienteVigente(
  session: AdminSessionData,
  modo: ModoPendiente,
  tenantId: string | null,
  ahora = Date.now(),
): Pendiente2fa | null {
  const p = session.mfaPendiente
  if (!p || p.modo !== modo || !tenantId || p.tenantId !== tenantId || p.hasta < ahora) return null
  return p
}

/** Fila del usuario para el segundo paso, revalidada (borrado, desactivado, contraseña reseteada). */
export async function usuarioDelPendiente(p: Pendiente2fa) {
  const [u] = await getDb()
    .select({
      id: adminUsers.id,
      name: adminUsers.name,
      email: adminUsers.email,
      role: adminUsers.role,
      tenantId: adminUsers.tenantId,
      passwordHash: adminUsers.passwordHash,
      sessionsRevokedBefore: adminUsers.sessionsRevokedBefore,
      totpSecretEnc: adminUsers.totpSecretEnc,
      totpRecoveryHashes: adminUsers.totpRecoveryHashes,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, p.userId))
  if (!u || u.tenantId !== p.tenantId || u.passwordHash === null) return null
  if (u.sessionsRevokedBefore && p.emitida < u.sessionsRevokedBefore.getTime()) return null
  return u
}

/** Cupo de intentos de código por usuario (compartido entre instancias). */
export function permitirIntento2fa(userId: string): Promise<boolean> {
  return permitirAsync(`admin-2fa:${userId}`, MAX_INTENTOS_2FA, VENTANA_INTENTOS_2FA_MS)
}

/**
 * Valida un código de la app contra el secreto guardado y lo "quema": el UPDATE sólo pasa si
 * el paso es posterior al último usado, así que el mismo código no vale dos veces (ni en dos
 * requests simultáneos).
 */
export async function consumirCodigoApp(userId: string, secretoEnc: string, codigo: string, ahora = Date.now()) {
  let secreto: string
  try {
    secreto = descifrarSecreto(secretoEnc)
  } catch {
    console.error(`[admin-2fa] no se pudo descifrar el secreto de ${userId} (¿cambió OTP_SECRET/SESSION_SECRET?)`)
    return false
  }
  const paso = verificarTotp(secreto, codigo, ahora)
  if (paso === null) return false
  const filas = await getDb()
    .update(adminUsers)
    .set({ totpLastStep: paso })
    .where(and(eq(adminUsers.id, userId), or(isNull(adminUsers.totpLastStep), lt(adminUsers.totpLastStep, paso))))
    .returning({ id: adminUsers.id })
  return filas.length === 1
}

/** Usa un código de respaldo (lo borra de la lista en el mismo UPDATE). Devuelve cuántos quedan, o null. */
export async function consumirCodigoRespaldo(userId: string, codigo: string): Promise<number | null> {
  const hash = hashCodigoRespaldo(codigo)
  const filas = await getDb()
    .update(adminUsers)
    .set({ totpRecoveryHashes: sql`array_remove(${adminUsers.totpRecoveryHashes}, ${hash})` })
    .where(and(eq(adminUsers.id, userId), sql`${hash} = ANY(${adminUsers.totpRecoveryHashes})`))
    .returning({ quedan: sql<number>`cardinality(${adminUsers.totpRecoveryHashes})` })
  return filas.length === 1 ? Number(filas[0].quedan) : null
}

/** Código de la app o de respaldo. `quedanRespaldo` sólo viene si se usó uno de respaldo. */
export async function verificarSegundoPaso(
  userId: string,
  secretoEnc: string,
  codigo: string,
): Promise<{ ok: boolean; quedanRespaldo?: number }> {
  if (pareceCodigoRespaldo(codigo)) {
    const quedan = await consumirCodigoRespaldo(userId, codigo)
    return quedan === null ? { ok: false } : { ok: true, quedanRespaldo: quedan }
  }
  return { ok: await consumirCodigoApp(userId, secretoEnc, codigo) }
}

/**
 * Confirma el alta: el código tiene que validar contra el secreto nuevo. Guarda secreto, paso y
 * códigos de respaldo sólo si el usuario todavía no tenía 2FA (dos altas en paralelo no se pisan).
 * Devuelve los códigos de respaldo en claro (se muestran una sola vez) o null.
 */
export async function confirmarAlta(userId: string, secretoEnc: string, codigo: string, ahora = Date.now()) {
  let secreto: string
  try {
    secreto = descifrarSecreto(secretoEnc)
  } catch {
    return null
  }
  const paso = verificarTotp(secreto, codigo, ahora)
  if (paso === null) return null
  const { codigos, hashes } = generarCodigosRespaldo()
  const filas = await getDb()
    .update(adminUsers)
    .set({ totpSecretEnc: secretoEnc, totpEnabledAt: new Date(ahora), totpLastStep: paso, totpRecoveryHashes: hashes })
    .where(and(eq(adminUsers.id, userId), isNull(adminUsers.totpSecretEnc)))
    .returning({ id: adminUsers.id })
  return filas.length === 1 ? codigos : null
}

/** Códigos de respaldo nuevos (invalida los anteriores). */
export async function regenerarCodigosRespaldo(userId: string): Promise<string[]> {
  const { codigos, hashes } = generarCodigosRespaldo()
  await getDb().update(adminUsers).set({ totpRecoveryHashes: hashes }).where(eq(adminUsers.id, userId))
  return codigos
}

/**
 * Borra el 2FA de un usuario (perdió el celular). Cierra todas sus sesiones: en el próximo
 * login lo vuelve a dar de alta.
 */
export async function quitar2fa(userId: string) {
  await getDb()
    .update(adminUsers)
    .set({
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      totpRecoveryHashes: [],
      sessionsRevokedBefore: new Date(),
    })
    .where(eq(adminUsers.id, userId))
}

export async function datosPantallaAlta(secreto: string, email: string, emisor: string) {
  const uri = uriOtpauth(secreto, emisor, email)
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
  return { qrSvg, clave: secreto.replace(/(.{4})/g, "$1 ").trim(), cuenta: email, emisor }
}

/** Pantalla de alta a partir del secreto cifrado guardado en la cookie. */
export async function pantallaAltaDesdeCifrado(secretoEnc: string, email: string, emisor: string) {
  return datosPantallaAlta(descifrarSecreto(secretoEnc), email, emisor)
}

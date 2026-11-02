import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { getGuardedAdminSession } from "@/lib/admin-session"
import { adminUnauthorizedResponse } from "@/lib/admin-route-guard"
import { consumirCodigoApp, permitirIntento2fa, regenerarCodigosRespaldo } from "@/lib/admin-2fa"

const NO_STORE = { "Cache-Control": "private, no-store" }

async function estado(userId: string) {
  const [u] = await getDb()
    .select({
      totpSecretEnc: adminUsers.totpSecretEnc,
      totpEnabledAt: adminUsers.totpEnabledAt,
      totpRecoveryHashes: adminUsers.totpRecoveryHashes,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, userId))
  return u ?? null
}

/**
 * Verificación en dos pasos del propio usuario (pantalla Seguridad). Es obligatoria para todos:
 * no se activa ni se desactiva desde acá (el alta es en el login; el restablecimiento, en Usuarios).
 *  GET  → estado y cuántos códigos de respaldo quedan.
 *  POST { codigo } → códigos de respaldo nuevos (invalida los anteriores). Pide un código de la app.
 */
export async function GET(req: Request) {
  const guard = await getGuardedAdminSession(req)
  if (!guard.ok) return adminUnauthorizedResponse()
  const u = await estado(guard.user.id)
  if (!u) return adminUnauthorizedResponse()
  return NextResponse.json(
    {
      activa: !!u.totpSecretEnc,
      activadaEn: u.totpEnabledAt?.toISOString() ?? null,
      codigosRespaldoRestantes: u.totpRecoveryHashes.length,
    },
    { headers: NO_STORE },
  )
}

export async function POST(req: Request) {
  const guard = await getGuardedAdminSession(req)
  if (!guard.ok) return adminUnauthorizedResponse()
  const { user } = guard
  const u = await estado(user.id)
  if (!u) return adminUnauthorizedResponse()
  if (!u.totpSecretEnc) {
    return NextResponse.json({ error: "La verificación en dos pasos no está activa." }, { status: 409, headers: NO_STORE })
  }

  const body = await req.json().catch(() => null)
  const codigo = typeof body?.codigo === "string" ? body.codigo.trim().slice(0, 20) : ""
  if (!codigo) return NextResponse.json({ error: "Ingrese el código de su app." }, { status: 400, headers: NO_STORE })
  if (!(await permitirIntento2fa(user.id))) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espere unos minutos e inténtelo de nuevo." },
      { status: 429, headers: NO_STORE },
    )
  }
  if (!(await consumirCodigoApp(user.id, u.totpSecretEnc, codigo))) {
    return NextResponse.json({ error: "Código incorrecto o ya usado." }, { status: 401, headers: NO_STORE })
  }
  return NextResponse.json({ ok: true, codigosRespaldo: await regenerarCodigosRespaldo(user.id) }, { headers: NO_STORE })
}

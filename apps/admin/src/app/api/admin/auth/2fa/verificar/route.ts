import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { resolveRequestTenantId } from "@/lib/tenant-context"
import {
  abrirSesionCompleta,
  pendienteVigente,
  permitirIntento2fa,
  usuarioDelPendiente,
  verificarSegundoPaso,
} from "@/lib/admin-2fa"

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * POST /api/admin/auth/2fa/verificar — segundo paso del login: código de la app autenticadora
 * o un código de respaldo. Requiere la cookie pendiente que deja /api/admin/auth/login.
 */
export async function POST(req: Request) {
  const tenantId = await resolveRequestTenantId(req)
  const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
  const pendiente = pendienteVigente(session, "verificar", tenantId)
  if (!pendiente) {
    return NextResponse.json(
      { error: "La verificación venció. Ingrese de nuevo con su email y contraseña.", code: "vencido" },
      { status: 401, headers: NO_STORE },
    )
  }

  const body = await req.json().catch(() => null)
  const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : ""
  if (!codigo || codigo.length > 20) {
    return NextResponse.json({ error: "Ingrese el código." }, { status: 400, headers: NO_STORE })
  }

  if (!(await permitirIntento2fa(pendiente.userId))) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espere unos minutos e inténtelo de nuevo." },
      { status: 429, headers: NO_STORE },
    )
  }

  const user = await usuarioDelPendiente(pendiente)
  if (!user || !user.totpSecretEnc) {
    session.destroy()
    return NextResponse.json(
      { error: "La verificación venció. Ingrese de nuevo con su email y contraseña.", code: "vencido" },
      { status: 401, headers: NO_STORE },
    )
  }

  const r = await verificarSegundoPaso(user.id, user.totpSecretEnc, codigo)
  if (!r.ok) {
    return NextResponse.json({ error: "Código incorrecto o ya usado." }, { status: 401, headers: NO_STORE })
  }

  await abrirSesionCompleta(session, user, pendiente.tenantId)
  return NextResponse.json(
    { ok: true, ...(r.quedanRespaldo !== undefined ? { quedanRespaldo: r.quedanRespaldo } : {}) },
    { headers: NO_STORE },
  )
}

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { adminSessionOptions, type AdminSessionData } from "@/lib/admin-session"
import { getTenantConfig, resolveRequestTenantId } from "@/lib/tenant-context"
import {
  abrirSesionCompleta,
  confirmarAlta,
  pantallaAltaDesdeCifrado,
  pendienteVigente,
  permitirIntento2fa,
  usuarioDelPendiente,
} from "@/lib/admin-2fa"

const NO_STORE = { "Cache-Control": "no-store" }

const VENCIDO = { error: "La configuración venció. Ingrese de nuevo con su email y contraseña.", code: "vencido" }

/**
 * Alta obligatoria del 2FA durante el login (admin/superadmin sin 2FA).
 *  GET  → QR y clave para cargar en la app autenticadora.
 *  POST → { codigo }: confirma el alta, abre la sesión y devuelve los códigos de respaldo (una vez).
 */
export async function GET(req: Request) {
  const tenantId = await resolveRequestTenantId(req)
  const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
  const pendiente = pendienteVigente(session, "alta", tenantId)
  if (!pendiente?.secretoEnc) return NextResponse.json(VENCIDO, { status: 401, headers: NO_STORE })

  const user = await usuarioDelPendiente(pendiente)
  if (!user) return NextResponse.json(VENCIDO, { status: 401, headers: NO_STORE })

  const tenant = await getTenantConfig()
  return NextResponse.json(await pantallaAltaDesdeCifrado(pendiente.secretoEnc, user.email, tenant.name), {
    headers: NO_STORE,
  })
}

export async function POST(req: Request) {
  const tenantId = await resolveRequestTenantId(req)
  const session = await getIronSession<AdminSessionData>(await cookies(), adminSessionOptions)
  const pendiente = pendienteVigente(session, "alta", tenantId)
  if (!pendiente?.secretoEnc) return NextResponse.json(VENCIDO, { status: 401, headers: NO_STORE })

  const body = await req.json().catch(() => null)
  const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : ""
  if (!codigo || codigo.length > 20) {
    return NextResponse.json({ error: "Ingrese el código de 6 dígitos." }, { status: 400, headers: NO_STORE })
  }
  if (!(await permitirIntento2fa(pendiente.userId))) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espere unos minutos e inténtelo de nuevo." },
      { status: 429, headers: NO_STORE },
    )
  }

  const user = await usuarioDelPendiente(pendiente)
  if (!user) {
    session.destroy()
    return NextResponse.json(VENCIDO, { status: 401, headers: NO_STORE })
  }
  // Alguien ya lo dio de alta en paralelo (otra pestaña): que ingrese con el código.
  if (user.totpSecretEnc) {
    session.destroy()
    return NextResponse.json(
      { error: "La verificación en dos pasos ya está activa. Ingrese de nuevo con su email y contraseña.", code: "vencido" },
      { status: 409, headers: NO_STORE },
    )
  }

  const codigos = await confirmarAlta(user.id, pendiente.secretoEnc, codigo)
  if (!codigos) {
    return NextResponse.json(
      { error: "El código no coincide. Revise que la hora de su celular esté bien y pruebe con el código nuevo." },
      { status: 401, headers: NO_STORE },
    )
  }

  await abrirSesionCompleta(session, user, pendiente.tenantId)
  return NextResponse.json({ ok: true, codigosRespaldo: codigos }, { headers: NO_STORE })
}

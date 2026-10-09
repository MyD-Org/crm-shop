import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { sessionOptionsForHost, otpSessionOptions } from "@/lib/session"
import { getTenantConfig } from "@/lib/tenant-context"
import { getCliente } from "@/lib/erp"
import { AlegraRateLimitError } from "@/lib/alegra"
import { intentarOtp } from "@/lib/portal-otp"
import { ipDe, permitir } from "@/lib/rate-limit"
import type { SessionData, OtpSessionData } from "@/types"

// Verificación del código del portal. El estado del código (hash, vencimiento, intentos, un
// solo uso) vive en `portal_otps` y lo administra src/lib/portal-otp.ts: la cookie trae sólo el
// id, así que reenviar una cookie vieja no reinicia nada.
//
// Límite por IP además del tope de 5 intentos por código: un atacante puede pedir un código
// nuevo por cada víctima, y esto frena el barrido masivo en una sola instancia (ver CAVEAT en
// src/lib/rate-limit.ts). 60 cada 15 minutos cubre de sobra una oficina detrás de una IP:
// un login legítimo son 1 o 2 intentos.
const MAX_VERIFY_POR_IP = 60
const VERIFY_WINDOW_MS = 15 * 60 * 1000

const PEDIR_OTRO = "Solicite un nuevo código."

export async function POST(request: Request) {
  try {
    const tenant = await getTenantConfig()
    const body = await request.json()
    const { code, redirectTo } = body as { code: string; redirectTo?: string }

    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return Response.json({ error: "Código inválido" }, { status: 400 })
    }

    if (!permitir(`verify-code:${tenant.id}:ip:${ipDe(request)}`, MAX_VERIFY_POR_IP, VERIFY_WINDOW_MS)) {
      return Response.json(
        { error: "Demasiados intentos. Espere unos minutos e inténtelo de nuevo." },
        { status: 429 },
      )
    }

    const cookieStore = await cookies()
    const otpSession = await getIronSession<OtpSessionData>(cookieStore, otpSessionOptions)
    if (!otpSession.otpId) {
      return Response.json({ error: `La verificación expiró. ${PEDIR_OTRO}` }, { status: 400 })
    }

    const resultado = await intentarOtp({ id: otpSession.otpId, tenantId: tenant.id, code })
    if (!resultado.ok) {
      switch (resultado.motivo) {
        case "incorrecto":
          return Response.json({ error: "Código incorrecto" }, { status: 400 })
        case "agotado":
          otpSession.destroy()
          return Response.json({ error: `Demasiados intentos fallidos. ${PEDIR_OTRO}` }, { status: 429 })
        case "vencido":
          otpSession.destroy()
          return Response.json({ error: `El código expiró. ${PEDIR_OTRO}` }, { status: 400 })
        default:
          otpSession.destroy()
          return Response.json({ error: `La verificación expiró. ${PEDIR_OTRO}` }, { status: 400 })
      }
    }

    // El contacto ya se resolvió al pedir el código: se lee por id (1 request) en vez de
    // volver a buscarlo por email/CUIT.
    const clienteData = await getCliente(tenant, resultado.codigocliente).catch((err) => {
      if (err instanceof AlegraRateLimitError) throw err
      return null
    })
    if (!clienteData) {
      return Response.json({ error: "No encontramos una cuenta asociada. Comuníquese con la sucursal." }, { status: 404 })
    }

    // Las opciones salen del HOST: una COOKIE_DOMAIN que no cubra este host hace que
    // el navegador descarte la cookie en silencio y el dashboard rebote al login.
    const session = await getIronSession<SessionData>(
      cookieStore,
      sessionOptionsForHost(request.headers.get("host")),
    )
    session.isLoggedIn = true
    session.codigocliente = clienteData.codigocliente
    session.razonsocial = clienteData.razonsocial
    session.cuit = clienteData.cuit
    // El email del contacto en Alegra, no lo tipeado (que es el CUIT, CUIL o DNI). Lo leen los
    // comprobantes del portal y la tienda como email del cliente.
    session.email = clienteData.email
    session.tipoCuenta = clienteData.tipoCuenta
    await session.save()

    otpSession.destroy()

    // redirectTo viene de la tienda; solo se acepta si el origen coincide con SHOP_REDIRECT_ORIGIN
    const safeRedirect = (() => {
      if (!redirectTo) return "/portal/dashboard"
      const allowed = process.env.SHOP_REDIRECT_ORIGIN
      if (!allowed) return "/portal/dashboard"
      try {
        const url = new URL(redirectTo)
        if (url.origin === allowed) return redirectTo
      } catch {}
      return "/portal/dashboard"
    })()
    return Response.json({ success: true, redirect: safeRedirect })
  } catch (err) {
    // Mismo criterio que send-code: el límite de Alegra es transitorio y el código sigue
    // válido, así que se le dice qué hacer en vez de un 500 (o un "no encontramos su cuenta").
    if (err instanceof AlegraRateLimitError) {
      console.error("verify-code: Alegra rate limit:", err.name)
      return Response.json(
        { error: "El sistema está con mucha demanda en este momento. Intente nuevamente en un minuto." },
        { status: 503 },
      )
    }
    console.error("verify-code error:", err)
    return Response.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

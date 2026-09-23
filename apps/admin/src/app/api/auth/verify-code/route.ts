import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { sessionOptionsForHost, otpSessionOptions } from "@/lib/session"
import { getTenantConfig } from "@/lib/tenant-context"
import { getCliente, getClienteByIdentifier } from "@/lib/erp"
import { AlegraRateLimitError } from "@/lib/alegra"
import type { SessionData, OtpSessionData } from "@/types"

// Intentos de verificación permitidos por código antes de invalidarlo.
const MAX_OTP_ATTEMPTS = 5

export async function POST(request: Request) {
  try {
    const tenant = await getTenantConfig()
    const body = await request.json()
    const { code, redirectTo } = body as { code: string; redirectTo?: string }

    if (!code || code.length !== 6) {
      return Response.json({ error: "Código inválido" }, { status: 400 })
    }

    const cookieStore = await cookies()

    // `attempts` no está en OtpSessionData; se extiende localmente. Vive en la cookie
    // sellada, por lo que el cliente no puede resetearlo para saltear el límite.
    const otpSession = await getIronSession<OtpSessionData & { attempts?: number }>(
      cookieStore,
      otpSessionOptions,
    )

    if (!otpSession.otp || !otpSession.otpExpiry || !otpSession.identifier) {
      return Response.json({ error: "La verificación expiró. Solicite un nuevo código." }, { status: 400 })
    }

    if (Date.now() > otpSession.otpExpiry) {
      otpSession.destroy()
      return Response.json({ error: "El código expiró. Solicite uno nuevo." }, { status: 400 })
    }

    if (otpSession.otp !== code) {
      // Límite de intentos: tras MAX_OTP_ATTEMPTS fallos invalidamos el código.
      const attempts = (otpSession.attempts ?? 0) + 1
      if (attempts >= MAX_OTP_ATTEMPTS) {
        otpSession.destroy()
        return Response.json(
          { error: "Demasiados intentos fallidos. Solicite un nuevo código." },
          { status: 429 },
        )
      }
      otpSession.attempts = attempts
      await otpSession.save()
      return Response.json({ error: "Código incorrecto" }, { status: 400 })
    }

    // El contacto ya se resolvió al pedir el código: se lee por id (1 request) en vez de
    // volver a buscarlo por email/CUIT. Las sesiones emitidas antes de este cambio no
    // traen el id y caen a la búsqueda.
    const clienteData = otpSession.codigocliente
      ? await getCliente(tenant, otpSession.codigocliente).catch((err) => {
          if (err instanceof AlegraRateLimitError) throw err
          return null
        })
      : await getClienteByIdentifier(tenant, otpSession.identifier)
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

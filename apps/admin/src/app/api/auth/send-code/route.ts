import { cookies } from "next/headers"
import { getIronSession } from "iron-session"
import { otpSessionOptions } from "@/lib/session"
import { getTenantConfig } from "@/lib/tenant-context"
import { getClienteByIdentifier } from "@/lib/erp"
import { normalizarDocumento } from "@/lib/documento-portal"
import { AlegraRateLimitError } from "@/lib/alegra"
import { sendEmail, maskEmail } from "@/lib/email"
import { buildOtpEmail } from "@/lib/otp-email"
import { emitirOtp } from "@/lib/portal-otp"
import { ipDe, permitir } from "@/lib/rate-limit"
import type { OtpSessionData } from "@/types"

// Código de acceso al portal del cliente. Se entra SOLO con CUIT, CUIL o DNI: se resuelve
// contra Alegra y el código se manda SIEMPRE al email que el contacto tiene cargado
// ahí. El mail del ERP es el dato autoritativo; sin mail cargado no hay acceso hasta
// que la sucursal lo cargue.
//
// El código NO viaja en la cookie: se guarda como HMAC en `portal_otps` (0075) y la cookie
// sellada lleva sólo el id. Ver src/lib/portal-otp.ts.

// ── Límite de envíos ────────────────────────────────────────────────────────
// Este endpoint es anónimo y dispara un mail: sin límite es un generador de spam
// gratis contra los clientes del tenant. Ventana por (tenant, identificador) y, aparte, por IP:
// el límite por identificador se esquiva tipeando un CUIT distinto en cada intento, y cada
// búsqueda gasta cuota de Alegra (compartida con el bot y el checkout del Shop). 20 cada 15
// minutos sobra para una oficina detrás de una sola IP.
// CAVEAT: el contador es por proceso (ver src/lib/rate-limit.ts).
const MAX_SENDS = 5
const MAX_SENDS_POR_IP = 20
const SEND_WINDOW_MS = 15 * 60 * 1000

export async function POST(request: Request) {
  try {
    const tenant = await getTenantConfig()
    const body = await request.json()
    const { identifier: raw } = body as { identifier: string }

    const identifier = typeof raw === "string" ? normalizarDocumento(raw) : null
    if (!identifier) {
      return Response.json(
        { error: "Ingrese una identificación válida, solo con números." },
        { status: 400 },
      )
    }

    if (
      !permitir(`send-code:${tenant.id}:ip:${ipDe(request)}`, MAX_SENDS_POR_IP, SEND_WINDOW_MS) ||
      !permitir(`send-code:${tenant.id}:${identifier}`, MAX_SENDS, SEND_WINDOW_MS)
    ) {
      return Response.json(
        { error: "Pidió demasiados códigos. Espere unos minutos." },
        { status: 429 },
      )
    }

    // La cuenta se resuelve ACÁ y no recién al verificar: sin esto mandaríamos un mail
    // (o ninguno) y el usuario se enteraría de que no existe después de tipear 6 dígitos.
    const cliente = await getClienteByIdentifier(tenant, identifier)
    if (!cliente) {
      return Response.json(
        {
          error:
            "No encontramos una cuenta con esa identificación. Verifique el número o comuníquese con la sucursal.",
        },
        { status: 404 },
      )
    }
    if (!cliente.email) {
      return Response.json(
        {
          error:
            "Su cuenta todavía no tiene un email cargado. Comuníquese con la sucursal para que le den el alta en el portal.",
        },
        { status: 409 },
      )
    }

    // El código queda en la base (como HMAC) ANTES de mandarlo: si el envío falla, la fila
    // sobra pero no hace daño (vence sola y el próximo pedido la reemplaza). Al revés —mandar
    // y después fallar al guardar— dejaría al cliente con un código que no sirve.
    const otp = await emitirOtp({ tenantId: tenant.id, identifier, codigocliente: cliente.codigocliente })

    const { subject, html, text } = buildOtpEmail(tenant, cliente.razonsocial, otp.code)
    let delivered: boolean
    try {
      delivered = await sendEmail(tenant, cliente.email, subject, html, text)
    } catch (err) {
      // No se sella la cookie: un código que no llegó no debe dejar al usuario esperando en
      // la pantalla de los 6 dígitos.
      console.error("send-code: falló el envío del email:", err)
      return Response.json(
        { error: "No pudimos enviar el código. Intente nuevamente en unos minutos." },
        { status: 502 },
      )
    }

    const session = await getIronSession<OtpSessionData>(await cookies(), otpSessionOptions)
    session.otpId = otp.id
    await session.save()

    // No logueamos el OTP en claro. Fuera de producción se devuelve como devCode para QA
    // (mismo patrón que ai-api /admin/auth/request-code): sin RESEND_API_KEY el envío es
    // dry-run y este es el único modo de completar el login en local.
    const isProd = process.env.NODE_ENV === "production"
    return Response.json({
      success: true,
      message: "Código enviado",
      sentTo: maskEmail(cliente.email),
      ...(isProd ? {} : { devCode: otp.code, delivered }),
    })
  } catch (err) {
    // Alegra limita por requests/minuto. Es transitorio y no es culpa de quien escribió su
    // CUIT: merece un mensaje que diga qué hacer, no un 500 genérico.
    if (err instanceof AlegraRateLimitError) {
      console.error("send-code: Alegra rate limit:", err.message)
      return Response.json(
        { error: "El sistema está con mucha demanda en este momento. Intente nuevamente en un minuto." },
        { status: 503 },
      )
    }
    console.error("send-code error:", err)
    return Response.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

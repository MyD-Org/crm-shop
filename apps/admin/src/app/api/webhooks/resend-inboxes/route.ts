import { correoHabilitado } from "@/lib/correo-flag"
import { borrarEvento, casillaPorInbox, limpiarEventosViejos, registrarEvento, upsertHilo } from "@/lib/correo-repo"
import { parsearEventoCorreo, verificarFirmaSvix, type EventoCorreo } from "@/lib/correo-webhook"
import { sendPushToCasilla } from "@/lib/push"

// POST /api/webhooks/resend-inboxes
//
// Webhook de Resend Inboxes (beta). Mantiene el espejo mínimo del correo (carpeta y leído por
// hilo, para el badge) y avisa por push a quienes tienen acceso a la casilla. No guarda cuerpos,
// asuntos ni remitentes.
//
// - Auth: firma svix (svix-id / svix-timestamp / svix-signature) sobre el body CRUDO, con
//   RESEND_INBOXES_WEBHOOK_SECRET y tolerancia de 5 min. Sin secreto = 401 (falla cerrada).
//   Resend firma: no hay token en la URL ni tenant en el path (el tenant sale de la casilla).
// - Flag `correo` (Vercel Flags) apagado: 200 sin procesar ni registrar el evento.
// - Idempotencia: svix-id en correo_eventos; un replay devuelve 200 sin efectos. Si el
//   procesamiento falla se borra el registro y se responde 500 para que Resend reintente.
// - Inbox desconocida / casilla inactiva / evento no soportado: 200 sin escrituras.
// - Logs: tenant, tipo y acción. Nunca valores del cuerpo (asunto, remitentes).

/** Los eventos son chicos (sin cuerpos de mail): un tope bajo corta basura antes de parsear. */
const MAX_BODY_BYTES = 256 * 1024
const ASUNTO_PUSH_MAX = 80

function ok(accion: string) {
  return Response.json({ ok: true, accion })
}

function truncar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`
}

async function aplicar(evento: EventoCorreo, casilla: { id: string; tenantId: string; nombre: string }) {
  const base = { eventoAt: evento.ocurridoAt }
  switch (evento.tipo) {
    case "email_recibido": {
      // Un "recibido" saliente no debería ocurrir; si el payload lo trae, se trata como enviado.
      if (evento.direccion === "outbound") {
        await upsertHilo(casilla.id, evento.threadId, { ...base, folder: evento.carpeta ?? "sent", leido: true })
        return "hilo_actualizado"
      }
      const carpeta = evento.carpeta ?? "inbox"
      await upsertHilo(casilla.id, evento.threadId, { ...base, folder: carpeta, leido: false })
      // Solo lo que cae en Recibidos avisa: spam/papelera no molestan.
      if (carpeta === "inbox") {
        await sendPushToCasilla(casilla.tenantId, casilla.id, {
          title: `Correo nuevo en ${casilla.nombre}`,
          body: evento.asunto ? truncar(evento.asunto, ASUNTO_PUSH_MAX) : "Nuevo mensaje",
          url: `/admin/inbox?casilla=${casilla.id}&hilo=${encodeURIComponent(evento.threadId)}`,
          tag: `correo-${evento.threadId}`,
        })
        return "hilo_nuevo_con_push"
      }
      return "hilo_actualizado"
    }
    case "hilo_creado":
      await upsertHilo(casilla.id, evento.threadId, {
        ...base,
        folder: evento.carpeta ?? (evento.direccion === "outbound" ? "sent" : undefined),
        leido: evento.leido ?? (evento.direccion === "outbound" ? true : undefined),
      })
      return "hilo_actualizado"
    case "carpeta":
      if (!evento.carpeta) return "sin_carpeta"
      await upsertHilo(casilla.id, evento.threadId, { ...base, folder: evento.carpeta, leido: evento.leido ?? undefined })
      return "hilo_actualizado"
    case "email_enviado":
      // Lo enviamos nosotros: no notifica y no deja el hilo como no leído.
      await upsertHilo(casilla.id, evento.threadId, { ...base, folder: evento.carpeta ?? "sent", leido: evento.leido ?? true })
      return "hilo_actualizado"
  }
}

export async function POST(req: Request) {
  const declarado = Number(req.headers.get("content-length") ?? "0")
  if (declarado > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 })
  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 })

  const svixId = req.headers.get("svix-id")
  const firmaOk = verificarFirmaSvix({
    id: svixId,
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
    rawBody,
    secret: process.env.RESEND_INBOXES_WEBHOOK_SECRET,
  })
  if (!firmaOk || !svixId) return Response.json({ error: "unauthorized" }, { status: 401 })

  if (!(await correoHabilitado())) return ok("flag_apagado")

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 })
  }
  const evento = parsearEventoCorreo(json)
  if (!evento) return ok("ignorado")

  let registrado = false
  try {
    const casilla = await casillaPorInbox(evento.inboxId)
    if (!casilla || !casilla.activa) return ok("casilla_desconocida")

    registrado = await registrarEvento(svixId)
    if (!registrado) return ok("replay")

    const accion = await aplicar(evento, casilla)
    console.log(`[correo-webhook] tenant=${casilla.tenantId} tipo=${evento.tipo} accion=${accion}`)

    // Limpieza oportunista de eventos viejos (idempotencia a 30 días). Best-effort.
    if (Math.random() < 0.02) limpiarEventosViejos().catch(() => {})
    return ok(accion)
  } catch (err) {
    // Que Resend reintente: sin el registro, el reintento no se toma por replay.
    if (registrado) await borrarEvento(svixId).catch(() => {})
    console.error(`[correo-webhook] tipo=${evento.tipo} accion=error error=${err instanceof Error ? err.name : "desconocido"}`)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}

import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { errorJson, errorLectura } from "@/lib/correo-admin"
import { armarEnvio, type AdjuntoParaEnviar, type MensajeOriginal } from "@/lib/correo-compose"
import { parseEnvioBody } from "@/lib/correo-envio-body"
import { dominioRecibeCorreo } from "@/lib/correo-dominio"
import { requireCorreoLector } from "@/lib/correo-lectura"
import { marcarHilo } from "@/lib/correo-repo"
import {
  getAttachmentDownloadUrl,
  getThreadEmail,
  listReceivedAttachments,
  replyInThread,
  sendDraft,
  type CorreoAdjunto,
  type CorreoMensajeConCuerpo,
} from "@/lib/correo-resend"
import { validarDestinatarios } from "@/lib/correo-validacion"
import { correoKeys, getR2 } from "@/lib/r2"

// Segundos que la URL GET de un adjunto de R2 sigue vigente para que Resend la baje.
const TTL_DESCARGA_S = 900

function originalDe(m: CorreoMensajeConCuerpo): MensajeOriginal {
  return {
    direccion: m.direccion,
    de: m.de,
    para: m.para,
    cc: m.cc,
    replyTo: m.replyTo,
    asunto: m.asunto,
    messageId: m.messageId,
    recibidoEn: m.recibidoEn,
    texto: m.texto,
  }
}

// POST /api/admin/correo/enviar — responder, responder a todos, reenviar o redactar.
//
// El `from` sale SIEMPRE de la casilla autorizada (cualquier otro valor del cliente se ignora).
// Sale siempre por la vía nativa de la inbox (reply del hilo, o draft + send), así queda
// registrado en la casilla. Idempotency-Key evita el doble envío. Los adjuntos nuevos viajan por URL
// de R2 y los del reenvío con la download_url recién resuelta del adjunto recibido: nada pasa por esta función.
// Antes de enviar se validan los destinatarios (typos de dominio y MX): 422 con mensaje en usted.
//
// Los objetos de correo/tmp/ no se borran acá: no hay garantía de que Resend termine de bajarlos
// antes de responder, y los limpia la regla de ciclo de vida de 1 día del bucket.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const casillaId = typeof (body as { casillaId?: unknown } | null)?.casillaId === "string" ? (body as { casillaId: string }).casillaId : ""
  const guard = await requireCorreoLector(req, casillaId)
  if (!guard.ok) return guard.response

  const parsed = parseEnvioBody(body)
  if (!parsed.ok) return errorJson(parsed.error, 400)
  const e = parsed.valor
  const { casilla, tenantId } = guard
  const remitente = { nombre: casilla.nombre, email: casilla.email }

  try {
    // Mensaje original (de la propia casilla: Resend responde 404 si no pertenece a ella).
    let mensaje: CorreoMensajeConCuerpo | null = null
    if (e.modo !== "nuevo" && e.hiloId && e.mensajeId) {
      mensaje = await getThreadEmail(casilla.resendInboxId, e.hiloId, e.mensajeId)
      if (mensaje.id !== e.mensajeId) return adminNotFoundResponse()
    }
    const original = mensaje ? originalDe(mensaje) : undefined

    // Adjuntos nuevos: la key viene del navegador, así que solo vale la del prefijo propio, y el
    // tamaño que cuenta es el que dice R2 (no el declarado).
    const r2 = getR2()
    const nuevos: { key: string; nombre: string; tamano: number }[] = []
    if (e.adjuntos.length > 0) {
      if (!r2) return errorJson("El almacenamiento de adjuntos no está configurado. Avise al administrador.", 503, "no_configurado")
      for (const a of e.adjuntos) {
        if (!correoKeys.esDelTenant(tenantId, a.key)) return errorJson("Uno de los adjuntos no es válido. Vuelva a adjuntarlo.", 400)
        const h = await r2.head(a.key)
        if (!h) return errorJson("Uno de los adjuntos ya no está disponible. Vuelva a adjuntarlo.", 400, "adjunto_vencido")
        nuevos.push({ key: a.key, nombre: a.nombre, tamano: h.size })
      }
    }

    // Adjuntos del mensaje original a reenviar (sus tamaños se conocen sin resolver URLs).
    let reenviados: CorreoAdjunto[] = []
    if (e.modo === "reenviar" && e.reenviarAdjuntos && mensaje) {
      reenviados = mensaje.adjuntos
      if (reenviados.length === 0 && mensaje.adjuntosCount > 0) reenviados = await listReceivedAttachments(mensaje.id)
    }

    // Primera pasada con URLs de relleno: valida destinatarios, tipos y tope de 40 MB SIN pedir
    // ninguna URL firmada ni llamar a Resend para enviar.
    const entrada = { casilla: remitente, modo: e.modo, original, para: e.para, cc: e.cc, cco: e.cco, asunto: e.asunto, texto: e.texto }
    const relleno = (a: { nombre: string; tamano: number }): AdjuntoParaEnviar => ({ nombre: a.nombre, tamano: a.tamano, url: "pendiente" })
    const prueba = armarEnvio({ ...entrada, adjuntosNuevos: nuevos.map(relleno), adjuntosReenvio: reenviados.map(relleno) })
    if (!prueba.ok) return errorJson(prueba.error, 400)

    const destinatarios = [...prueba.payload.to, ...(prueba.payload.cc ?? []), ...(prueba.payload.bcc ?? [])]
    const validacion = await validarDestinatarios(destinatarios, dominioRecibeCorreo)
    if (!validacion.ok) {
      return Response.json(
        { error: validacion.error, code: "destinatario", ...(validacion.sugerencia ? { sugerencia: validacion.sugerencia } : {}) },
        { status: 422, headers: { "Cache-Control": "private, no-store" } },
      )
    }

    const adjuntosNuevos: AdjuntoParaEnviar[] = []
    for (const a of nuevos) {
      adjuntosNuevos.push({ nombre: a.nombre, tamano: a.tamano, url: await r2!.presignGet(a.key, { ttlSeconds: TTL_DESCARGA_S }) })
    }
    const adjuntosReenvio: AdjuntoParaEnviar[] = []
    for (const a of reenviados) {
      const d = await getAttachmentDownloadUrl(mensaje!.id, a.id)
      adjuntosReenvio.push({ nombre: a.nombre, tamano: d.tamano || a.tamano, url: d.url })
    }

    const armado = armarEnvio({ ...entrada, adjuntosNuevos, adjuntosReenvio })
    if (!armado.ok) return errorJson(armado.error, 400)

    // Vía nativa de la inbox, siempre: responder -> /reply del mensaje (a los participantes del
    // hilo); redactar y reenviar -> draft standalone + envío. Los adjuntos se pasan igual (path):
    // hoy Resend los descarta en esta vía; cuando lo corrija funcionarán sin tocar nada acá.
    const responde = (e.modo === "responder" || e.modo === "responderATodos") && !!e.hiloId && !!e.mensajeId
    const p = armado.payload
    const enviado = responde
      ? await replyInThread(
          casilla.resendInboxId,
          e.hiloId!,
          e.mensajeId!,
          { cc: p.cc, bcc: p.bcc, subject: p.subject, html: p.html, text: p.text, attachments: p.attachments as { filename: string; path: string }[] | undefined },
          { idempotencyKey: e.claveIdempotencia },
        )
      : await sendDraft(
          casilla.resendInboxId,
          { to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, html: p.html, text: p.text, attachments: p.attachments as { filename: string; path: string }[] | undefined },
          { idempotencyKey: e.claveIdempotencia },
        )

    // Resend ya sumó el mensaje al thread (y el webhook de enviados también llega): el espejo se
    // toca solo al responder, y si falla no se le informa error a la persona.
    if (responde) {
      await marcarHilo(casilla.id, e.hiloId!, { leido: true }).catch(() => console.error("[correo] no se pudo actualizar el espejo del hilo"))
    }
    return Response.json(
      { ok: true, id: enviado.id },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (err) {
    return errorLectura(err)
  }
}

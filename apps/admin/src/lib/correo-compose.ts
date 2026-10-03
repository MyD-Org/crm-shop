import { fechaCompletaCorreo } from "@/lib/correo-formato"
import type { CorreoEnvioPayload } from "@/lib/correo-resend"

// Armado puro del mail saliente del correo compartido (responder, responder a todos, reenviar y
// redactar). Sin red ni DB: lo usa el servidor para construir el payload de POST /emails de
// Resend y el cliente para precargar los destinatarios. Todo envío sale por POST /emails (el
// endpoint /reply y los drafts de Resend descartan los adjuntos) con In-Reply-To/References
// para que Resend lo sume al thread y Gmail lo hile.

export type ModoEnvio = "responder" | "responderATodos" | "reenviar" | "nuevo"

export const MAX_DESTINATARIOS = 50
/** Límite de Resend por mail (base64 incluido). */
export const MAX_MAIL_BYTES = 40 * 1024 * 1024
/** El base64 agranda lo adjunto ~37 %: el tope se mide contra el tamaño ya codificado. */
const FACTOR_BASE64 = 1.37

/** Extensiones que no se aceptan como adjunto (ejecutables y scripts). */
export const EXTENSIONES_BLOQUEADAS = [
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "msp", "js", "jse", "vbs", "vbe", "wsf", "wsh",
  "ps1", "jar", "dll", "lnk", "hta", "cpl", "reg", "app", "apk", "dmg",
]

export interface MensajeOriginal {
  direccion: "inbound" | "outbound"
  de: string
  para: string[]
  cc: string[]
  replyTo: string[]
  asunto: string
  messageId: string | null
  recibidoEn: string
  /** Texto plano del original, si se conoce (para citarlo). */
  texto?: string | null
}

export interface AdjuntoParaEnviar {
  nombre: string
  tamano: number
  /** URL desde la que Resend baja el archivo (R2 prefirmada o download_url del adjunto recibido). */
  url: string
}

export interface EntradaEnvio {
  casilla: { nombre: string; email: string }
  modo: ModoEnvio
  original?: MensajeOriginal
  para: string[]
  cc: string[]
  cco: string[]
  asunto: string
  texto: string
  adjuntosNuevos: AdjuntoParaEnviar[]
  adjuntosReenvio: AdjuntoParaEnviar[]
}

export type ResultadoEnvio =
  | { ok: true; payload: CorreoEnvioPayload; aviso?: string }
  | { ok: false; error: string }

const SIN_ASUNTO = "(sin asunto)"
const AVISO_SIN_MESSAGE_ID = "La respuesta podría no agruparse en la conversación."
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

/** "Ana <Ana@X.example>" -> "ana@x.example"; sin nombre, la dirección en minúsculas. */
export function direccionDe(valor: string): string {
  const m = valor.match(/<([^>]+)>\s*$/)
  return (m ? m[1] : valor).trim().toLowerCase()
}

export function esEmailValido(valor: string): boolean {
  return EMAIL_RE.test(valor)
}

export function asuntoResponder(asunto: string): string {
  const a = asunto.trim()
  if (!a) return `Re: ${SIN_ASUNTO}`
  return /^(re|rv):\s*/i.test(a) ? a : `Re: ${a}`
}

export function asuntoReenviar(asunto: string): string {
  const a = asunto.trim()
  if (!a) return `Fwd: ${SIN_ASUNTO}`
  return /^(fwd?|rv|re):\s*/i.test(a) ? a : `Fwd: ${a}`
}

/** Quita duplicados sin distinguir mayúsculas, en el orden de aparición, y normaliza a minúsculas. */
function unicas(direcciones: string[], excluir: Set<string> = new Set()): string[] {
  const vistas = new Set(excluir)
  const salida: string[] = []
  for (const d of direcciones) {
    const dir = direccionDe(d)
    if (!dir || vistas.has(dir)) continue
    vistas.add(dir)
    salida.push(dir)
  }
  return salida
}

/** Destinatarios que se precargan en el compositor; la persona puede editarlos. */
export function destinatariosPorDefecto(
  modo: ModoEnvio,
  original: MensajeOriginal | undefined,
  casillaEmail: string,
): { para: string[]; cc: string[] } {
  if (!original || modo === "reenviar" || modo === "nuevo") return { para: [], cc: [] }
  const propia = new Set([direccionDe(casillaEmail)])
  const destinoBase = original.replyTo.length > 0 ? original.replyTo : original.direccion === "outbound" ? original.para : [original.de]
  if (modo === "responder") return { para: unicas(destinoBase), cc: [] }

  // Responder a todos: remitente (o reply_to) + to originales, cc originales; sin la propia casilla.
  const para = unicas([...destinoBase, ...original.para], propia)
  const cc = unicas(original.cc, new Set([...propia, ...para]))
  const recorte = para.slice(0, MAX_DESTINATARIOS)
  return { para: recorte, cc: cc.slice(0, MAX_DESTINATARIOS - recorte.length) }
}

export function extensionBloqueada(nombre: string): string | null {
  const i = nombre.lastIndexOf(".")
  if (i < 0) return null
  const ext = nombre.slice(i + 1).trim().toLowerCase()
  return EXTENSIONES_BLOQUEADAS.includes(ext) ? ext : null
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
const escapar = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c])

/** Texto plano -> html simple y escapado: párrafos por línea en blanco, <br> por salto simple. */
export function textoAHtml(texto: string): string {
  const parrafos = texto
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.length > 0)
  return parrafos.map((p) => `<p>${escapar(p).replace(/\n/g, "<br>")}</p>`).join("")
}

/** "Nombre <email>" de la casilla; el nombre no puede romper el encabezado. */
function remitenteDe(casilla: { nombre: string; email: string }): string {
  const nombre = casilla.nombre.replace(/["<>,;\r\n]/g, "").replace(/\s+/g, " ").trim()
  return nombre ? `${nombre} <${casilla.email}>` : casilla.email
}

function citaDe(modo: ModoEnvio, o: MensajeOriginal): { text: string; html: string } {
  const fecha = fechaCompletaCorreo(o.recibidoEn)
  if (modo === "reenviar") {
    const lineas = [
      "---------- Mensaje reenviado ----------",
      `De: ${o.de}`,
      ...(fecha ? [`Fecha: ${fecha}`] : []),
      `Asunto: ${o.asunto || SIN_ASUNTO}`,
      ...(o.para.length > 0 ? [`Para: ${o.para.join(", ")}`] : []),
      ...(o.cc.length > 0 ? [`Cc: ${o.cc.join(", ")}`] : []),
    ]
    const cuerpo = o.texto?.trim() ?? ""
    return {
      text: `${lineas.join("\n")}\n\n${cuerpo}`,
      html: `<div>${lineas.map(escapar).join("<br>")}</div>${cuerpo ? `<div>${escapar(cuerpo).replace(/\n/g, "<br>")}</div>` : ""}`,
    }
  }
  const cuerpo = o.texto?.trim()
  if (!cuerpo) return { text: "", html: "" }
  const encabezado = `${fecha ? `El ${fecha}, ` : ""}${o.de} escribió:`
  return {
    text: `${encabezado}\n${cuerpo.split("\n").map((l) => `> ${l}`).join("\n")}`,
    html: `<p>${escapar(encabezado)}</p><blockquote>${escapar(cuerpo).replace(/\n/g, "<br>")}</blockquote>`,
  }
}

/**
 * Valida y arma el payload de POST /emails. El `from` sale SIEMPRE de la casilla recibida (nunca
 * de un valor del cliente). Los headers de hilado solo se agregan al responder y con message_id.
 */
export function armarEnvio(e: EntradaEnvio): ResultadoEnvio {
  const para = unicas(e.para)
  const cc = unicas(e.cc, new Set(para))
  const cco = unicas(e.cco, new Set([...para, ...cc]))
  const todas = [...para, ...cc, ...cco]
  const entradas = [...e.para, ...e.cc, ...e.cco].filter((d) => d.trim() !== "")

  if (para.length === 0 && entradas.length === 0) return { ok: false, error: "Indique al menos un destinatario." }
  if (todas.some((d) => !esEmailValido(d))) return { ok: false, error: "Revise las direcciones de correo ingresadas." }
  if (para.length === 0) return { ok: false, error: "Indique al menos un destinatario." }
  if (todas.length > MAX_DESTINATARIOS) return { ok: false, error: `No puede enviar a más de ${MAX_DESTINATARIOS} destinatarios.` }

  for (const a of e.adjuntosNuevos) {
    const ext = extensionBloqueada(a.nombre)
    if (ext) return { ok: false, error: `No se permite adjuntar archivos .${ext}.` }
  }
  const adjuntos = [...e.adjuntosNuevos, ...e.adjuntosReenvio]
  const total = adjuntos.reduce((s, a) => s + a.tamano, 0)
  if (total * FACTOR_BASE64 > MAX_MAIL_BYTES) return { ok: false, error: "Los adjuntos superan el máximo de 40 MB." }

  const texto = e.texto.replace(/\r\n?/g, "\n")
  if (texto.trim() === "" && adjuntos.length === 0 && e.modo !== "reenviar") {
    return { ok: false, error: "Escriba un mensaje o adjunte un archivo." }
  }

  const citar = e.original && (e.modo === "responder" || e.modo === "responderATodos" || e.modo === "reenviar")
  const cita = citar && e.original ? citaDe(e.modo, e.original) : { text: "", html: "" }
  const text = [texto.trim(), cita.text].filter(Boolean).join("\n\n")
  const html = `${textoAHtml(texto)}${cita.html}`

  const responde = e.modo === "responder" || e.modo === "responderATodos"
  let headers: Record<string, string> | undefined
  let aviso: string | undefined
  if (responde) {
    const id = e.original?.messageId?.trim()
    if (id) headers = { "In-Reply-To": id, References: id }
    else aviso = AVISO_SIN_MESSAGE_ID
  }

  const payload: CorreoEnvioPayload = {
    from: remitenteDe(e.casilla),
    to: para,
    ...(cc.length > 0 ? { cc } : {}),
    ...(cco.length > 0 ? { bcc: cco } : {}),
    subject: e.asunto.trim() || SIN_ASUNTO,
    html,
    text,
    ...(headers ? { headers } : {}),
    ...(adjuntos.length > 0 ? { attachments: adjuntos.map((a) => ({ filename: a.nombre, path: a.url })) } : {}),
  }
  return { ok: true, payload, ...(aviso ? { aviso } : {}) }
}

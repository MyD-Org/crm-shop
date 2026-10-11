import type { AlertaPieza } from "@/db/schema"
import type { ClienteInterno } from "./auth-interna"
import type { CamposTransicion, NuevaPieza } from "./piezas-repo"
import { CANALES, esUno, FORMATOS, OBJETIVOS, PRODUCCIONES, PUBLICOS, TEMAS, type BriefGrabacion } from "./tipos"

export const WORKER_RE = /^[\w.-]{1,60}$/
const MAX_CAPTION = 2200
const MAX_HASHTAGS = 30
const MAX_ALERTAS = 50
const MAX_MENSAJE_ALERTA = 500
const MAX_KEY = 500

// Validadores compartidos por la creación (POST) y por los campos que viajan con una transición (PATCH).
const esObjetoPlano = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const esCaption = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_CAPTION
const esHashtags = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_HASHTAGS && v.every((h) => typeof h === "string")
function esBrief(v: unknown): v is BriefGrabacion {
  if (!esObjetoPlano(v)) return false
  return (
    typeof v.guion === "string" &&
    Array.isArray(v.tomas) &&
    v.tomas.every((t) => typeof t === "string") &&
    typeof v.duracionSeg === "number" &&
    Number.isFinite(v.duracionSeg) &&
    v.duracionSeg >= 0 &&
    (v.fechaLimite === undefined || typeof v.fechaLimite === "string")
  )
}
const limpiarBrief = (v: BriefGrabacion): BriefGrabacion => ({
  guion: v.guion,
  tomas: v.tomas,
  duracionSeg: v.duracionSeg,
  ...(v.fechaLimite !== undefined ? { fechaLimite: v.fechaLimite } : {}),
})

/**
 * Alertas con la forma {regla, mensaje, severidad}; devuelve null si alguna no la cumple. Con
 * `soloEsaFuente` descarta las que declaran otra fuente; sin él, fuerza la fuente a `fuente`.
 */
function alertasConFuente(v: unknown, fuente: AlertaPieza["fuente"], soloEsaFuente = false): AlertaPieza[] | null {
  if (!Array.isArray(v) || v.length > MAX_ALERTAS) return null
  const salida: AlertaPieza[] = []
  for (const a of v) {
    if (!esObjetoPlano(a)) return null
    if (typeof a.regla !== "string" || a.regla.length === 0 || a.regla.length > 100) return null
    if (typeof a.mensaje !== "string" || a.mensaje.length > MAX_MENSAJE_ALERTA) return null
    if (a.severidad !== "alta" && a.severidad !== "media") return null
    if (soloEsaFuente && a.fuente !== fuente) continue
    salida.push({ regla: a.regla, mensaje: a.mensaje, severidad: a.severidad, fuente })
  }
  return salida
}

/** Alertas del chequeo con IA de la rutina: la fuente siempre se fuerza a "ia". */
export function validarAlertasIa(v: unknown): { ok: true; alertas: AlertaPieza[] } | { ok: false; error: string } {
  const alertas = alertasConFuente(v, "ia")
  return alertas ? { ok: true, alertas } : { ok: false, error: "invalid_alertas" }
}

// Valida el cuerpo de una pieza nueva. Devuelve el primer campo inválido como `invalid_<campo>`.
export function validarNuevaPieza(b: Record<string, unknown>): { ok: true; pieza: NuevaPieza } | { ok: false; error: string } {
  const enums: [string, readonly string[]][] = [
    ["canal", CANALES],
    ["formato", FORMATOS],
    ["publico", PUBLICOS],
    ["tema", TEMAS],
    ["objetivo", OBJETIVOS],
    ["produccion", PRODUCCIONES],
  ]
  for (const [campo, valores] of enums) if (!esUno(valores, b[campo])) return { ok: false, error: `invalid_${campo}` }
  if (typeof b.plantilla !== "string" || !/^[a-z0-9-]{1,60}$/.test(b.plantilla)) return { ok: false, error: "invalid_plantilla" }
  if (b.contenido !== undefined && !esObjetoPlano(b.contenido)) return { ok: false, error: "invalid_contenido" }
  if (b.caption !== undefined && !esCaption(b.caption)) return { ok: false, error: "invalid_caption" }
  if (b.hashtags !== undefined && !esHashtags(b.hashtags)) return { ok: false, error: "invalid_hashtags" }
  if (b.briefGrabacion != null && !esBrief(b.briefGrabacion)) return { ok: false, error: "invalid_briefGrabacion" }
  const programadaPara = b.programadaPara ? new Date(String(b.programadaPara)) : null
  if (programadaPara && isNaN(programadaPara.getTime())) return { ok: false, error: "invalid_programadaPara" }
  return {
    ok: true,
    pieza: {
      canal: b.canal as NuevaPieza["canal"],
      formato: b.formato as NuevaPieza["formato"],
      plantilla: b.plantilla,
      publico: b.publico as NuevaPieza["publico"],
      tema: b.tema as NuevaPieza["tema"],
      objetivo: b.objetivo as NuevaPieza["objetivo"],
      produccion: b.produccion as NuevaPieza["produccion"],
      contenido: b.contenido as Record<string, unknown> | undefined,
      caption: b.caption as string | undefined,
      hashtags: b.hashtags as string[] | undefined,
      productos: Array.isArray(b.productos) ? b.productos.map(String) : undefined,
      briefGrabacion: b.briefGrabacion != null ? limpiarBrief(b.briefGrabacion as BriefGrabacion) : null,
      programadaPara,
    },
  }
}

// Campos que cada cliente puede escribir junto con una transición (PATCH). Las alertas de reglas de
// marca nunca vienen del cliente: el servidor las calcula siempre. El studio sólo aporta las suyas
// (fuente "studio") y la rutina sólo registra su chequeo con IA por /chequeo-ia.
const CAMPOS_PERMITIDOS: Record<ClienteInterno, readonly (keyof CamposTransicion)[]> = {
  studio: ["renderKey", "portadaKey", "alertas"],
  planificador: ["contenido", "caption", "hashtags", "briefGrabacion"],
  aiapi: ["externoId", "permalink"],
}

const keyValida = (v: unknown, tenantId: string): v is string =>
  typeof v === "string" && v.length <= MAX_KEY && v.startsWith(`marketing/${tenantId}/`) && !v.includes("..")

export function validarCamposTransicion(
  cliente: ClienteInterno,
  b: Record<string, unknown>,
  tenantId: string,
): { ok: true; campos: CamposTransicion } | { ok: false; error: string } {
  const campos: CamposTransicion = {}
  for (const k of CAMPOS_PERMITIDOS[cliente]) {
    const v = b[k]
    if (v === undefined) continue
    switch (k) {
      case "contenido":
        if (!esObjetoPlano(v)) return { ok: false, error: "invalid_contenido" }
        campos.contenido = v
        break
      case "caption":
        if (!esCaption(v)) return { ok: false, error: "invalid_caption" }
        campos.caption = v
        break
      case "hashtags":
        if (!esHashtags(v)) return { ok: false, error: "invalid_hashtags" }
        campos.hashtags = v
        break
      case "briefGrabacion":
        if (v !== null && !esBrief(v)) return { ok: false, error: "invalid_briefGrabacion" }
        campos.briefGrabacion = v === null ? null : limpiarBrief(v)
        break
      case "renderKey":
      case "portadaKey":
        if (v !== null && !keyValida(v, tenantId)) return { ok: false, error: `invalid_${k}` }
        campos[k] = v
        break
      case "alertas": {
        const alertas = alertasConFuente(v, "studio", true)
        if (!alertas) return { ok: false, error: "invalid_alertas" }
        campos.alertas = alertas
        break
      }
      case "externoId":
        if (typeof v !== "string" || v.length === 0 || v.length > 200) return { ok: false, error: "invalid_externoId" }
        campos.externoId = v
        break
      case "permalink":
        if (typeof v !== "string" || v.length > 2000 || !v.startsWith("https://")) return { ok: false, error: "invalid_permalink" }
        campos.permalink = v
        break
    }
  }
  return { ok: true, campos }
}

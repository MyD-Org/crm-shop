import type { NuevaPieza } from "./piezas-repo"
import { CANALES, esUno, FORMATOS, OBJETIVOS, PRODUCCIONES, PUBLICOS, TEMAS } from "./tipos"

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
  if (b.contenido !== undefined && (typeof b.contenido !== "object" || b.contenido === null || Array.isArray(b.contenido))) return { ok: false, error: "invalid_contenido" }
  if (b.caption !== undefined && (typeof b.caption !== "string" || b.caption.length > 2200)) return { ok: false, error: "invalid_caption" }
  if (b.hashtags !== undefined && (!Array.isArray(b.hashtags) || b.hashtags.some((h) => typeof h !== "string") || b.hashtags.length > 30)) return { ok: false, error: "invalid_hashtags" }
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
      briefGrabacion: (b.briefGrabacion as NuevaPieza["briefGrabacion"]) ?? null,
      programadaPara,
    },
  }
}

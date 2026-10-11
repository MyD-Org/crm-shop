// Reglas de marca deterministas (las que tienen `patron`). Las reglas sin patrón las revisa
// el chequeo con IA de la rutina. Se evalúan al guardar en el CRM y de nuevo en el studio.
import type { AlertaPieza, ReglaMarca } from "@/db/schema"

function recolectar(valor: unknown, salida: string[]): void {
  if (typeof valor === "string") {
    if (valor.trim()) salida.push(valor)
  } else if (Array.isArray(valor)) {
    for (const v of valor) recolectar(v, salida)
  } else if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) recolectar(v, salida)
  }
}

export function textosDePieza(p: { caption: string; contenido: Record<string, unknown>; hashtags: string[] }): string[] {
  const salida: string[] = []
  recolectar(p.caption, salida)
  recolectar(p.hashtags, salida)
  recolectar(p.contenido, salida)
  return salida
}

const MAX_PATRON = 200
// Tope de texto que se prueba contra cada patrón: acota el costo aunque un patrón sea lento.
const MAX_TEXTO_EVALUADO = 5000
// Grupo cuantificado cuyo cuerpo ya contiene un cuantificador, p. ej. (a+)+, (\w*)*, (a|aa+)+:
// la forma clásica del backtracking catastrófico (ReDoS). Conservador: puede rechazar de más.
const CUANTIFICADORES_ANIDADOS = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/

/** Devuelve null si el patrón es aceptable, o un mensaje (en usted) con el motivo del rechazo. */
export function validarPatron(patron: string): string | null {
  if (patron.length > MAX_PATRON) return `El patrón no puede superar los ${MAX_PATRON} caracteres`
  try {
    new RegExp(patron, "iu")
  } catch {
    return "El patrón no es una expresión regular válida"
  }
  if (CUANTIFICADORES_ANIDADOS.test(patron)) {
    return "El patrón es demasiado complejo: evite repeticiones dentro de grupos que a su vez se repiten, por ejemplo (a+)+"
  }
  return null
}

export function evaluarReglas(textos: string[], reglas: ReglaMarca[]): AlertaPieza[] {
  const alertas: AlertaPieza[] = []
  const acotados = textos.map((t) => t.slice(0, MAX_TEXTO_EVALUADO))
  for (const regla of reglas) {
    if (!regla.patron) continue
    // Un patrón inseguro o que no compila se reporta como inválido y nunca se ejecuta.
    const re = validarPatron(regla.patron) === null ? new RegExp(regla.patron, "iu") : null
    if (!re) {
      alertas.push({ regla: regla.id, mensaje: `La regla «${regla.texto}» tiene un patrón inválido`, severidad: regla.severidad, fuente: "regla" })
      continue
    }
    if (acotados.some((t) => re.test(t))) {
      alertas.push({ regla: regla.id, mensaje: regla.texto, severidad: regla.severidad, fuente: "regla" })
    }
  }
  return alertas
}

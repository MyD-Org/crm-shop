// Reglas de marca deterministas (las que tienen `patron`: frases literales separadas por "|"). Las reglas sin patrón las revisa
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

// El `patron` de una regla es una lista de frases literales separadas por "|". Nunca se compila
// como expresión regular: lo escribe un administrador y una regex arbitraria permite ReDoS.
const MAX_PATRON = 300
const MAX_FRASES = 20
const MIN_FRASE = 2
const MAX_FRASE = 80
// Tope de texto que se prueba contra cada regla: acota el costo.
const MAX_TEXTO_EVALUADO = 5000

// Minúsculas, sin tildes ni marcas combinantes, espacios (y saltos de línea) colapsados.
function normalizar(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim()
}

function frasesDe(patron: string): string[] {
  return patron.split("|").map((f) => f.trim()).filter(Boolean)
}

/** Devuelve null si el patrón es aceptable, o un mensaje (en usted) con el motivo del rechazo. */
export function validarFrases(patron: string): string | null {
  if (patron.length > MAX_PATRON) return `Las frases no pueden superar los ${MAX_PATRON} caracteres en total`
  const frases = frasesDe(patron)
  if (frases.length === 0) return "Indique al menos una frase, separadas por «|» si son varias"
  if (frases.length > MAX_FRASES) return `Indique como máximo ${MAX_FRASES} frases`
  // Se mide también tras normalizar: una frase hecha sólo de marcas combinantes quedaría vacía y coincidiría con todo.
  if (frases.some((f) => f.length < MIN_FRASE || normalizar(f).length < MIN_FRASE)) return `Cada frase debe tener al menos ${MIN_FRASE} caracteres`
  if (frases.some((f) => f.length > MAX_FRASE)) return `Cada frase puede tener como máximo ${MAX_FRASE} caracteres`
  return null
}

export function evaluarReglas(textos: string[], reglas: ReglaMarca[]): AlertaPieza[] {
  const alertas: AlertaPieza[] = []
  const acotados = textos.map((t) => normalizar(t.slice(0, MAX_TEXTO_EVALUADO)))
  for (const regla of reglas) {
    if (!regla.patron) continue
    if (validarFrases(regla.patron) !== null) {
      alertas.push({ regla: regla.id, mensaje: `La regla «${regla.texto}» tiene un patrón inválido`, severidad: regla.severidad, fuente: "regla" })
      continue
    }
    const frases = frasesDe(regla.patron).map(normalizar)
    if (acotados.some((t) => frases.some((f) => t.includes(f)))) {
      alertas.push({ regla: regla.id, mensaje: regla.texto, severidad: regla.severidad, fuente: "regla" })
    }
  }
  return alertas
}

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

export function evaluarReglas(textos: string[], reglas: ReglaMarca[]): AlertaPieza[] {
  const alertas: AlertaPieza[] = []
  for (const regla of reglas) {
    if (!regla.patron) continue
    let re: RegExp
    try {
      re = new RegExp(regla.patron, "iu")
    } catch {
      alertas.push({ regla: regla.id, mensaje: `La regla «${regla.texto}» tiene un patrón inválido`, severidad: regla.severidad, fuente: "regla" })
      continue
    }
    if (textos.some((t) => re.test(t))) {
      alertas.push({ regla: regla.id, mensaje: regla.texto, severidad: regla.severidad, fuente: "regla" })
    }
  }
  return alertas
}

import { direccionDe } from "./correo-compose"

// Validación previa al envío: errores de tipeo frecuentes en el dominio y chequeo de que el
// dominio recibe correo (el MX lo resuelve correo-dominio.ts, inyectado acá para probar sin red).

const TYPOS: Record<string, string> = {
  "gmail.com.ar": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "outlok.com": "outlook.com",
}

function partes(valor: string): { local: string; dominio: string } | null {
  const dir = direccionDe(valor)
  const i = dir.lastIndexOf("@")
  if (i <= 0 || i === dir.length - 1) return null
  return { local: dir.slice(0, i), dominio: dir.slice(i + 1) }
}

/** Dirección corregida si el dominio es un error de tipeo conocido; null si no hay sugerencia. */
export function sugerirCorreccion(valor: string): string | null {
  const p = partes(valor)
  const corregido = p && TYPOS[p.dominio]
  return p && corregido ? `${p.local}@${corregido}` : null
}

export type ResultadoValidacion = { ok: true } | { ok: false; error: string; sugerencia?: string }

export async function validarDestinatarios(
  direcciones: string[],
  recibeCorreo: (dominio: string) => Promise<boolean>,
): Promise<ResultadoValidacion> {
  for (const d of direcciones) {
    const sugerencia = sugerirCorreccion(d)
    if (sugerencia) return { ok: false, error: `¿Quiso decir ${sugerencia}?`, sugerencia }
  }
  const dominios = [...new Set(direcciones.map((d) => partes(d)?.dominio).filter((x): x is string => !!x))]
  const resultados = await Promise.all(dominios.map(async (dom) => [dom, await recibeCorreo(dom)] as const))
  const malo = resultados.find(([, ok]) => !ok)
  if (malo) return { ok: false, error: `El dominio ${malo[0]} no recibe correo. Revise la dirección.` }
  return { ok: true }
}

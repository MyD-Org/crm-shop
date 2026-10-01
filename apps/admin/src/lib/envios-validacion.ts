// Validación pura de la configuración de envío (sin DB, sin Next): la comparten la API y el
// formulario de Envíos, así el operador ve el mismo mensaje en los dos lados. Textos en usted.
//
// Dos interruptores independientes: "Envío a domicilio" (se ofrece, con costo a coordinar) y
// "Envío gratis". Sólo con gratis en Sí aplican y se exigen el alcance (todo el país / solo
// estas provincias) y el mínimo (sin mínimo / desde $X, sin impuestos). Los NULL de la base
// significan únicamente "sin configurar": nunca "vacío = todo".

import { PROVINCIAS, claveProvincia, provinciaCanonica } from "@/lib/provincias"

export const ALCANCES = ["pais", "provincias"] as const
export type AlcanceEnvio = (typeof ALCANCES)[number]
export const MODOS_MINIMO = ["sin_minimo", "desde"] as const
export type ModoMinimoEnvio = (typeof MODOS_MINIMO)[number]

export interface ConfigEnvio {
  /** El Shop ofrece envío a domicilio (con costo a coordinar, salvo que además sea gratis). */
  domicilioActivo: boolean
  /** Interruptor del envío gratis; con false no aplican alcance ni mínimo. */
  gratisActivo: boolean
  alcance: AlcanceEnvio | null
  /** Claves de provincia (`claveProvincia`), como `zonas.provincia_clave`. */
  provincias: string[]
  minimoModo: ModoMinimoEnvio | null
  /** Sin impuestos; sólo con modo 'desde'. */
  minimo: number | null
}

/** Igual que los defaults de la migración 0049: domicilio Sí, gratis No, nada configurado. */
export const ENVIO_DEFAULT: ConfigEnvio = {
  domicilioActivo: true,
  gratisActivo: false,
  alcance: null,
  provincias: [],
  minimoModo: null,
  minimo: null,
}

/** Tope: la columna es numeric(12,2); un 99999999999 por error de tipeo no tiene sentido. */
export const MAX_MINIMO = 1_000_000_000

export const MSG_ALCANCE = "Seleccione el alcance del envío gratis."
export const MSG_MODO = "Seleccione si el envío gratis tiene monto mínimo."
export const MSG_SIN_PROVINCIAS = "Seleccione al menos una provincia."
export const MSG_PROVINCIA_INVALIDA = "Una de las provincias indicadas no es válida."
export const MSG_MONTO = "Ingrese un monto mayor a cero."

export type Invalido = { ok: false; campo: string; error: string }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Monto como número o texto ("100000", "100000,50"); null si no es un número finito mayor a cero. */
function parsearMonto(v: unknown): number | null {
  let n: number
  if (typeof v === "number") n = v
  else if (typeof v === "string" && /^\s*\d+([.,]\d{1,2})?\s*$/.test(v)) n = Number(v.trim().replace(",", "."))
  else return null
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MINIMO) return null
  return Math.round(n * 100) / 100
}

/**
 * Valida la configuración COMPLETA (la UI manda todos los campos). Con gratis en No no se exige
 * nada, pero lo que venga y sea válido se conserva (apagar no borra lo cargado); lo inválido se
 * descarta a "sin configurar". Las provincias se guardan como `claveProvincia`, sin duplicados.
 */
export function validarEnvio(body: unknown): { ok: true; envio: ConfigEnvio } | Invalido {
  if (!esObjeto(body)) return { ok: false, campo: "body", error: "Los datos indicados no son válidos." }

  if (typeof body.domicilioActivo !== "boolean") return { ok: false, campo: "domicilioActivo", error: "El valor indicado no es válido." }
  if (typeof body.gratisActivo !== "boolean") return { ok: false, campo: "gratisActivo", error: "El valor indicado no es válido." }
  const gratisActivo = body.gratisActivo

  // Provincias: siempre se validan contra el catálogo (una desconocida es error, esté o no activo).
  let provincias: string[] = []
  if (body.provincias !== undefined && body.provincias !== null) {
    if (!Array.isArray(body.provincias)) return { ok: false, campo: "provincias", error: MSG_PROVINCIA_INVALIDA }
    const claves = new Set<string>()
    for (const p of body.provincias) {
      const canon = typeof p === "string" ? provinciaCanonica(p) : null
      if (!canon) return { ok: false, campo: "provincias", error: MSG_PROVINCIA_INVALIDA }
      claves.add(canon.clave)
    }
    provincias = [...claves]
  }

  const alcance = (ALCANCES as readonly unknown[]).includes(body.alcance) ? (body.alcance as AlcanceEnvio) : null
  const minimoModo = (MODOS_MINIMO as readonly unknown[]).includes(body.minimoModo) ? (body.minimoModo as ModoMinimoEnvio) : null
  const monto = parsearMonto(body.minimo)

  if (gratisActivo) {
    if (!alcance) return { ok: false, campo: "alcance", error: MSG_ALCANCE }
    if (alcance === "provincias" && provincias.length === 0) return { ok: false, campo: "provincias", error: MSG_SIN_PROVINCIAS }
    if (!minimoModo) return { ok: false, campo: "minimoModo", error: MSG_MODO }
    if (minimoModo === "desde" && monto === null) return { ok: false, campo: "minimo", error: MSG_MONTO }
  }

  return {
    ok: true,
    envio: {
      domicilioActivo: body.domicilioActivo,
      gratisActivo,
      alcance,
      // 'pais' no usa la lista: no se guarda.
      provincias: alcance === "provincias" ? provincias : [],
      minimoModo,
      // 'sin_minimo' ignora el monto; sólo 'desde' lo guarda.
      minimo: minimoModo === "desde" ? monto : null,
    },
  }
}

const nombreDeClave = (clave: string): string => PROVINCIAS.find((p) => claveProvincia(p) === clave) ?? clave

export function formatearMonto(n: number): string {
  const [entero, decimales] = n.toFixed(2).split(".")
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return decimales === "00" ? `$${miles}` : `$${miles},${decimales}`
}

function listar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ""
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`
}

/** Resumen en una frase de lo que va a ver el cliente; lo muestra la sección Envíos antes de guardar. */
export function textoPreview(c: ConfigEnvio): string {
  if (!c.domicilioActivo) return "No se ofrece envío a domicilio: solo retiro en el local."
  if (!c.gratisActivo || !c.alcance || !c.minimoModo) return "Envío gratis: no. El envío a domicilio es con costo a coordinar."
  const minimo = c.minimoModo === "desde" && c.minimo !== null ? ` desde ${formatearMonto(c.minimo)}` : ""
  if (c.alcance === "pais") {
    return c.minimoModo === "desde" && c.minimo !== null ? `Gratis en todo el país${minimo}.` : "Gratis en todo el país, sin monto mínimo."
  }
  if (c.provincias.length === 0) return "Todavía no hay provincias seleccionadas: el envío no será gratis en ninguna."
  const donde = listar(c.provincias.map(nombreDeClave))
  const cond = c.minimoModo === "desde" && c.minimo !== null ? minimo : " sin monto mínimo"
  return `Gratis en ${donde}${cond}; en el resto, costo a coordinar.`
}

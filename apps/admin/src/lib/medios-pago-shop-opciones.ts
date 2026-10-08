// Opciones de cobro de un medio con cobro en línea (migración 0073, change `cuotas-en-el-formulario`):
// qué formas de pago ofrece el checkout. Mercado Pago tiene tres; Payway, crédito y débito (una
// `cuenta_mp` guardada en Payway se ignora). Puro: lo comparten la API y la tarjeta del admin.

export const OPCIONES_COBRO = ["credito", "debito", "cuenta_mp"] as const
export type OpcionCobro = (typeof OPCIONES_COBRO)[number]

/** Opciones que cada procesador sabe cobrar, en el orden en que se muestran. */
export const OPCIONES_POR_MEDIO: Readonly<Record<string, readonly OpcionCobro[]>> = {
  mercadopago: ["credito", "debito", "cuenta_mp"],
  payway: ["credito", "debito"],
}

export const ROTULO_OPCION: Readonly<Record<OpcionCobro, string>> = {
  credito: "Tarjeta de crédito",
  debito: "Tarjeta de débito",
  cuenta_mp: "Cuenta de Mercado Pago",
}

export const MSG_OPCIONES_INVALIDAS = "Las formas de pago indicadas no son válidas."
export const MSG_SIN_OPCIONES = "Seleccione al menos una forma de pago, o desactive el medio."

const esOpcion = (v: unknown): v is OpcionCobro => typeof v === "string" && (OPCIONES_COBRO as readonly string[]).includes(v)

/** Valida lo que llega en el cuerpo: un array de opciones conocidas, sin repetir. Devuelve el orden canónico. */
export function validarOpciones(v: unknown): { ok: true; opciones: OpcionCobro[] } | { ok: false; error: string } {
  if (!Array.isArray(v) || !v.every(esOpcion) || new Set(v).size !== v.length) {
    return { ok: false, error: MSG_OPCIONES_INVALIDAS }
  }
  return { ok: true, opciones: OPCIONES_COBRO.filter((o) => v.includes(o)) }
}

/** Opciones que el procesador del medio puede cobrar (con un slug sin procesador conocido, las válidas). */
export function opcionesDelMedio(slug: string): readonly OpcionCobro[] {
  return OPCIONES_POR_MEDIO[slug] ?? OPCIONES_COBRO
}

/** De las guardadas, las que el procesador del medio puede cobrar (Payway ignora `cuenta_mp`). */
export function opcionesAplicables(slug: string, opciones: readonly string[]): OpcionCobro[] {
  return opcionesDelMedio(slug).filter((o) => opciones.includes(o))
}

/**
 * Regla sobre el estado RESULTANTE del medio: activo y con cobro en línea necesita al menos una
 * opción aplicable. Inactivo o sin cobro en línea, las opciones no se exigen. null = válido.
 */
export function errorDeOpcionesResultantes(m: {
  slug: string
  activo: boolean
  cobroOnline: boolean
  opcionesCobro: readonly string[]
}): string | null {
  if (!m.activo || !m.cobroOnline) return null
  return opcionesAplicables(m.slug, m.opcionesCobro).length === 0 ? MSG_SIN_OPCIONES : null
}

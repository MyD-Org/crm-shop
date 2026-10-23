// Validación pura del plazo de despacho (sin DB, sin Next): la comparten la API y la tarjeta
// "Plazo de despacho" de Envíos, así el operador ve el mismo mensaje en los dos lados. Textos en
// usted.
//
// Es el plazo que el Shop promete para el envío a domicilio: cuándo SALE el pedido, no cuándo
// llega (la demora del flete no se conoce). Si hay que traer el producto de otra sucursal, el
// Shop le suma "Días de demora al traer de otra sucursal" (reglas de venta).

export interface ConfigDespacho {
  /** ¿El Shop muestra el plazo de despacho? */
  visible: boolean
  /** Días hábiles desde la compra; 1 se muestra como "24 h hábiles". */
  diasHabiles: number
}

/** Igual que los defaults de la migración 0093: lo que el Shop mostraba antes de configurarse. */
export const DESPACHO_DEFAULT: ConfigDespacho = { visible: true, diasHabiles: 1 }

/** Mismo rango que el CHECK de la migración 0093. */
export const MIN_DIAS_DESPACHO = 1
export const MAX_DIAS_DESPACHO = 30

export const MSG_DIAS = `Ingrese un número entero de días entre ${MIN_DIAS_DESPACHO} y ${MAX_DIAS_DESPACHO}.`

export type Invalido = { ok: false; campo: string; error: string }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Días como número o texto ("3"); null si no es un entero dentro del rango. */
function parsearDias(v: unknown): number | null {
  let n: number
  if (typeof v === "number") n = v
  else if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) n = Number(v.trim())
  else return null
  return Number.isInteger(n) && n >= MIN_DIAS_DESPACHO && n <= MAX_DIAS_DESPACHO ? n : null
}

/**
 * Valida la configuración COMPLETA (la UI manda los dos campos). Con el plazo oculto los días se
 * siguen exigiendo válidos: ocultarlo no borra lo cargado.
 */
export function validarDespacho(body: unknown): { ok: true; despacho: ConfigDespacho } | Invalido {
  if (!esObjeto(body)) return { ok: false, campo: "body", error: "Los datos indicados no son válidos." }
  if (typeof body.visible !== "boolean") return { ok: false, campo: "visible", error: "El valor indicado no es válido." }
  const dias = parsearDias(body.diasHabiles)
  if (dias === null) return { ok: false, campo: "diasHabiles", error: MSG_DIAS }
  return { ok: true, despacho: { visible: body.visible, diasHabiles: dias } }
}

/**
 * "dentro de las 24 h hábiles" / "dentro de N días hábiles". Es la MISMA frase que arma el Shop
 * (`apps/clientes/src/lib/disponibilidad-textos.ts`, `despacho()`); si cambia allá, cambiarla acá.
 */
export function plazoDespacho(dias: number): string {
  return dias <= 1 ? "dentro de las 24 h hábiles" : `dentro de ${dias} días hábiles`
}

/** Lo que verá el cliente en la fila de envío a domicilio, con stock y trayéndolo de otra sucursal. */
export function textoPreview(c: ConfigDespacho): { conStock: string; aTraer: string } {
  if (!c.visible) {
    return {
      conStock: "Disponible (sin plazo de despacho).",
      aTraer: "Disponible en los días de demora al traer de otra sucursal (reglas de venta).",
    }
  }
  return {
    conStock: `Despacho ${plazoDespacho(c.diasHabiles)}.`,
    aTraer: `Despacho dentro de ${c.diasHabiles} ${c.diasHabiles === 1 ? "día hábil" : "días hábiles"} más los días de demora al traer de otra sucursal (reglas de venta).`,
  }
}

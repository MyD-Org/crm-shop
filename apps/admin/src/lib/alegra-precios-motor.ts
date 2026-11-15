// Funciones PURAS del motor de precios de Alegra (change `listas-alegra-desde-costo`). En R1 sólo
// las dos que necesita la escritura: pasar a centavos y mezclar la lista de precios de un ítem.
// El resto (clasificar, huella, aprobación) se agrega en R2.

/** Entrada de la lista de precios de un ítem, como la acepta el PUT /items/{id} de Alegra. */
export interface PrecioItemInput {
  idPriceList: string | number
  price: number
}

/**
 * Monto -> centavos enteros, redondeo half-up (lejos del cero). Texto o número; `null`, vacío o no
 * numérico -> null. Se opera sobre la representación decimal (no multiplicando por 100 en punto
 * flotante), así `160.005` da 16001 y `160` da 16000.
 */
export function aCentavos(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === "number" && !Number.isFinite(v)) return null
  const s = String(v).trim()
  if (s === "") return null
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) {
    // Notación científica u otra forma rara: último recurso, con el error de flotante que traiga.
    const n = Number(s)
    return Number.isFinite(n) ? Math.round(n * 100) : null
  }
  const [, signo, entera, frac = ""] = m
  const centavos = Number(entera) * 100 + Number((frac + "00").slice(0, 2))
  const sube = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0
  const total = centavos + sube
  return signo === "-" ? -total : total
}

/** Centavos -> número con 2 decimales exactos (para el body del PUT). */
export function deCentavos(c: number): number {
  return Math.round(c) / 100
}

const esNumerico = (id: string | number): boolean => typeof id === "number" || /^\d+$/.test(id)

/**
 * Mezcla los precios que Alegra tiene hoy en el ítem con los nuevos. Devuelve el arreglo COMPLETO
 * para mandar en el PUT (Alegra podría interpretar un arreglo parcial como "reemplazar la lista"):
 *  - conserva todas las listas que no se gestionan, tal cual (mismo `idPriceList`, mismo tipo);
 *  - reemplaza el precio de las listas destino que ya estaban, conservando el tipo de su id;
 *  - agrega las que faltan, con el tipo de id que ya usan las demás (texto si alguna lo usa; si no, número cuando el id es numérico).
 * Los precios nuevos se redondean a 2 decimales (half-up). No muta los argumentos.
 */
export function mergearPrecios(
  actuales: readonly PrecioItemInput[],
  nuevos: readonly { id: string; price: number }[],
): PrecioItemInput[] {
  const porId = new Map<string, number>()
  for (const n of nuevos) {
    const c = aCentavos(n.price)
    if (c === null) throw new Error(`Precio inválido para la lista ${n.id}`)
    porId.set(String(n.id), deCentavos(c))
  }
  const usados = new Set<string>()
  const salida: PrecioItemInput[] = actuales.map((a) => {
    const id = String(a.idPriceList)
    const nuevo = porId.get(id)
    if (nuevo === undefined) return { idPriceList: a.idPriceList, price: a.price }
    usados.add(id)
    return { idPriceList: a.idPriceList, price: nuevo }
  })
  const usaTexto = actuales.some((a) => typeof a.idPriceList === "string")
  for (const [id, price] of porId) {
    if (usados.has(id)) continue
    salida.push({ idPriceList: esNumerico(id) && !usaTexto ? Number(id) : id, price })
  }
  return salida
}

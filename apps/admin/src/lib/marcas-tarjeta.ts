// Marcas de tarjeta que el admin puede elegir para una condición de cuotas sin interés (migración
// 0074, change `cuotas-en-el-formulario`). Los ids son los canónicos que guarda la base y que el
// Shop traduce desde los ids de Mercado Pago y Payway (apps/clientes/src/lib/pagos/marcas.ts): esta
// lista es un subconjunto de aquel mapa; al sumar una marca acá, verificar que el Shop la conozca.
// Puro: lo comparten la API y la tarjeta del admin.

export const MARCAS_TARJETA = [
  { id: "visa", nombre: "Visa" },
  { id: "mastercard", nombre: "Mastercard" },
  { id: "amex", nombre: "American Express" },
  { id: "naranja", nombre: "Naranja" },
  { id: "cabal", nombre: "Cabal" },
  { id: "argencard", nombre: "Argencard" },
  { id: "diners", nombre: "Diners" },
] as const

export type MarcaTarjeta = (typeof MARCAS_TARJETA)[number]["id"]

const IDS: readonly string[] = MARCAS_TARJETA.map((m) => m.id)

export const esMarcaValida = (v: unknown): v is MarcaTarjeta => typeof v === "string" && IDS.includes(v)

export function nombreDeMarca(id: string): string {
  return MARCAS_TARJETA.find((m) => m.id === id)?.nombre ?? id
}

/** Mismas marcas, en el orden de la lista (así comparar y mostrar no depende del orden de carga). */
export function ordenarMarcas(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => IDS.indexOf(a) - IDS.indexOf(b))
}

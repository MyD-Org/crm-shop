/**
 * Etiquetas chicas con código de barras: rollo de 3 etiquetas de 29×20 mm por fila. Cada
 * etiqueta lleva el nombre arriba, el Code128 de la referencia de Alegra y la referencia abajo
 * (Alegra busca por referencia; el id interno no sirve).
 *
 *   npx tsx scripts/etiquetas/codigos.ts <lista.json> <prefijo-salida>
 *
 * lista.json = [[referencia, nombre, cantidad], …]. Arma tandas de 10 filas (30 etiquetas) en
 * <prefijo>-00.tspl, <prefijo>-01.tspl…, que se mandan con imprimir.ts.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { PUNTOS_POR_MM, barras, code128b } from "./tspl"

const MAX_CARACTERES = 18 // font "2" (12×20 puntos) en 29 mm
const ANCHO = 29 * PUNTOS_POR_MM
const COLUMNAS_MM = [2, 34, 66] // inicio de cada etiqueta con SIZE 100 mm y GAP 2 mm
const FILAS_POR_TANDA = 10

/** Las fuentes internas no traen tildes ni ñ. */
export function textoImprimible(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "'")
}

export function fila(items: Array<{ nombre: string; referencia: string }>): string {
  const L = ["SIZE 100 mm,20 mm", "GAP 2 mm,0 mm", "DIRECTION 0", "CLS"]
  items.forEach(({ nombre, referencia }, i) => {
    const n = textoImprimible(nombre).slice(0, MAX_CARACTERES)
    const r = textoImprimible(referencia)
    if (r.length > MAX_CARACTERES) throw new Error(`Referencia demasiado larga: ${r}`)
    const base = COLUMNAS_MM[i] * PUNTOS_POR_MM
    const patron = code128b(r)
    const { ancho } = barras(patron, 0, 0, 0)
    if (ancho > ANCHO - 16) throw new Error(`El código de ${r} no entra en 29 mm`)
    L.push(`TEXT ${base + Math.floor((ANCHO - n.length * 12) / 2)},20,"2",0,1,1,"${n}"`)
    L.push(...barras(patron, base + Math.floor((ANCHO - ancho) / 2), 46, 64).comandos)
    L.push(`TEXT ${base + Math.floor((ANCHO - r.length * 12) / 2)},118,"2",0,1,1,"${r}"`)
  })
  L.push("PRINT 1,1")
  return L.join("\r\n") + "\r\n"
}

async function main() {
  const [lista, prefijo] = process.argv.slice(2)
  if (!lista || !prefijo) {
    console.error("Uso: codigos.ts <lista.json> <prefijo-salida>")
    process.exit(1)
  }
  const filas = JSON.parse(readFileSync(lista, "utf8")) as Array<[string, string, number]>
  const etiquetas = filas.flatMap(([referencia, nombre, cantidad]) =>
    Array.from({ length: Math.max(0, Math.round(cantidad)) }, () => ({ referencia, nombre })),
  )
  const grupos: (typeof etiquetas)[] = []
  for (let i = 0; i < etiquetas.length; i += 3) grupos.push(etiquetas.slice(i, i + 3))
  let tandas = 0
  for (let k = 0; k < grupos.length; k += FILAS_POR_TANDA, tandas++) {
    const archivo = `${prefijo}-${String(tandas).padStart(2, "0")}.tspl`
    writeFileSync(archivo, grupos.slice(k, k + FILAS_POR_TANDA).map(fila).join(""))
  }
  console.log(`etiquetas ${etiquetas.length}, filas ${grupos.length}, tandas ${tandas}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

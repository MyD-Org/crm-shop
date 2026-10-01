/**
 * Verifica lo que leyeron los subagentes de los PDFs (`<dir>/lectura/crudo/*.jsonl`) contra el texto
 * real de cada PDF, y separa lo aceptado de lo descartado (con motivo). SIN red y SIN base.
 *
 *   npx tsx scripts/verificar-atributos-pdf.ts --dir <dir>
 *
 * Escribe `<dir>/lectura/aceptados.jsonl` y `<dir>/lectura/descartes.jsonl` (se pisan en cada corrida)
 * e imprime el resumen por clave y por motivo. Formato y reglas: scripts/README-atributos-pdf.md.
 */
import { formatearResumenVerificacion, verificarDirectorio } from "../src/lib/catalogo-atributos-lectura-local"

function valor(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const dir = valor(process.argv.slice(2), "--dir")
  if (!dir) throw new Error("Falta --dir <directorio con indice.json, pdfs/, recortes/ y lectura/crudo/>")
  const resumen = await verificarDirectorio(dir)
  console.log(formatearResumenVerificacion(resumen))
  console.log(`\nEscrito: ${dir}/lectura/aceptados.jsonl y ${dir}/lectura/descartes.jsonl`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

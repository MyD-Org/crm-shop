/**
 * `npm run banco:analizar-medidas -- <reporte.json> [--top=N] [--clave=<clave>]`
 *
 * Lee el JSON de una corrida del banco (`banco:busqueda --json=<ruta>`) e imprime, SÓLO agregados:
 * (a) los casos con más contradicciones duras (consulta, ids de medida del plan, clave, cuántos contradicen),
 * (b) los totales por clave (contradicciones duras/blandas, cobertura) y
 * (c) qué casos cambiarían por clave si la clave dejara de ser dura (o pasara a serlo).
 *
 * SOLO LECTURA de un archivo local: no abre la base ni la red, y no lee `.env*`. Un banco real (`--banco`)
 * ya viene enmascarado en el JSON; este script no lo desenmascara ni imprime ids de producto.
 */
import { readFileSync } from "node:fs";
import { formatearAnalisis, parsearArgsAnalisis, parsearReporteMedidas } from "./analisis-medidas";

function main(argv: readonly string[]): void {
  const args = parsearArgsAnalisis(argv);
  let texto: string;
  try {
    texto = readFileSync(args.archivo, "utf8");
  } catch {
    throw new Error(`No se pudo leer el archivo: ${args.archivo}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    // El mensaje de JSON.parse cita un fragmento del contenido: no se reenvía.
    throw new Error(`El archivo no es un JSON válido: ${args.archivo}`);
  }
  console.log(formatearAnalisis(parsearReporteMedidas(json), args));
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`[analizar-medidas] ${err instanceof Error ? err.message : "error"}`);
  process.exitCode = 1;
}

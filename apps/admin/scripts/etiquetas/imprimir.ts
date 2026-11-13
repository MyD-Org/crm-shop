/**
 * Manda un archivo .tspl directo por USB a la impresora (VID 0416, PID 5011). El backend USB de
 * CUPS se cuelga en "Enviando datos" con esta impresora; por eso se usa el paquete `usb`.
 *
 *   ETIQUETAS_DEPS=~/.etiquetas-deps npx tsx scripts/etiquetas/imprimir.ts <archivo.tspl> [<archivo2.tspl> …]
 *
 * Si un trabajo queda colgado, solo se suelta apagando la impresora.
 */
import { readFileSync } from "node:fs"
import { requerirExterno } from "./tspl"

type Endpoint = { direction: "in" | "out"; timeout: number; transfer(d: Buffer, cb: (e?: Error) => void): void }
type Interfaz = { endpoints: Endpoint[]; claim(): void; release(cerrar: boolean, cb: () => void): void }
type Dispositivo = { open(): void; close(): void; interfaces: Interfaz[] }

async function main() {
  const archivos = process.argv.slice(2)
  if (archivos.length === 0) {
    console.error("Uso: imprimir.ts <archivo.tspl> [...]")
    process.exit(1)
  }

  const { findByIds } = requerirExterno<{ findByIds(vid: number, pid: number): Dispositivo | undefined }>("usb")
  const dispositivo = findByIds(0x0416, 0x5011)
  if (!dispositivo) {
    console.error("No se encontró la impresora por USB (¿encendida y conectada?).")
    process.exit(1)
  }
  dispositivo.open()
  const interfaz = dispositivo.interfaces[0]
  interfaz.claim()
  const salida = interfaz.endpoints.find((e) => e.direction === "out")
  if (!salida) throw new Error("La impresora no expone un endpoint de salida.")
  salida.timeout = 120_000

  const enviar = (datos: Buffer) =>
    new Promise<void>((ok, mal) => salida.transfer(datos, (e) => (e ? mal(e) : ok())))

  try {
    for (const archivo of archivos) {
      const datos = readFileSync(archivo)
      await enviar(datos)
      console.log(`enviado ${archivo} (${datos.length} bytes)`)
    }
  } finally {
    interfaz.release(true, () => dispositivo.close())
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

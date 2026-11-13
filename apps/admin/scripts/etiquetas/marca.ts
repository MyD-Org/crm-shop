/**
 * Etiqueta grande de la tienda (100×150 mm): logo, rubro, dirección, WhatsApp y QR a la web.
 * Arma un HTML, lo fotografía con Chrome headless al tamaño exacto en puntos (800×1200 a
 * 203 dpi) y lo pasa a TSPL como bitmap de 1 bit (así salen tildes y tipografía real).
 *
 *   ETIQUETAS_DEPS=~/.etiquetas-deps npx tsx scripts/etiquetas/marca.ts <config.json> <salida-sin-extension> [copias]
 *
 * Genera <salida>.html, <salida>.png (vista previa) y <salida>.tspl. Config: ver
 * marca.ejemplo.json. Los datos reales van en un *.local.json (ignorado por git): el repo es
 * público.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pngATspl, PUNTOS_POR_MM, requerirExterno } from "./tspl"

type Config = {
  /** SVG del logo, con ruta relativa al config. */
  logo: string
  /** Reemplazos de color en el SVG (fill="#X" → fill="#Y"); la impresora es monocromo. */
  logoColores?: Record<string, string>
  rubro?: string
  direccion: string
  ciudad?: string
  whatsapp?: string
  /** Texto de la web tal como se imprime, en un renglón. */
  web: string
  /** URL del QR. */
  qr: string
  qrTitulo?: string
  qrLeyenda?: string
  gapMm?: number
  densidad?: number
}

const ANCHO_MM = 100
const ALTO_MM = 150
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const ICONO_WHATSAPP =
  '<svg class="ico" viewBox="0 0 24 24"><path fill="#000" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.54-3.69 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43s.17-.25.25-.41c.08-.17.04-.31-.02-.43s-.56-1.34-.76-1.84c-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18s-.22-.16-.47-.28z"/></svg>'

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function html(c: Config, logoSvg: string, qrSvg: string): string {
  let logo = logoSvg.replace(/<\?xml[^>]*>/, "").replace("<svg ", '<svg class="logo" ')
  for (const [de, a] of Object.entries(c.logoColores ?? {})) logo = logo.split(`fill="${de}"`).join(`fill="${a}"`)
  const qr = qrSvg.replace("<svg ", '<svg class="qr" ')
  return `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:800px;height:1200px;background:#fff;color:#000;font-family:"Avenir Next","Helvetica Neue",sans-serif}
.e{width:800px;height:1200px;padding:70px 56px 56px;display:flex;flex-direction:column;align-items:center}
.logo{width:500px;height:auto}
.rubro{margin-top:30px;font-size:31px;font-weight:600;letter-spacing:.5px}
.sep{width:100%;border-top:5px solid #000;margin:40px 0 0}
.dir{margin-top:44px;font-size:100px;font-weight:700;letter-spacing:-1px;white-space:nowrap;line-height:1}
.ciu{margin-top:14px;font-size:58px;font-weight:500}
.tel{margin-top:44px;display:flex;align-items:center;gap:22px;font-size:76px;font-weight:700;letter-spacing:1px}
.ico{width:84px;height:84px}
.pie{margin-top:auto;width:100%;display:flex;align-items:center;gap:30px}
.qr{width:270px;height:270px;flex:none;display:block}
.txt{flex:1;display:flex;flex-direction:column;gap:18px;min-width:0}
.et{font-size:30px;font-weight:600;letter-spacing:6px}
.web{background:#000;color:#fff;border-radius:18px;padding:22px 0;text-align:center;font-size:32px;font-weight:700;line-height:1.15;white-space:nowrap}
.esc{font-size:28px;font-weight:500}
</style><div class="e">${logo}
${c.rubro ? `<div class="rubro">${esc(c.rubro)}</div>` : ""}<div class="sep"></div>
<div class="dir">${esc(c.direccion)}</div>${c.ciudad ? `<div class="ciu">${esc(c.ciudad)}</div>` : ""}
${c.whatsapp ? `<div class="tel">${ICONO_WHATSAPP}${esc(c.whatsapp)}</div>` : ""}
<div class="pie">${qr}<div class="txt"><div class="et">${esc(c.qrTitulo ?? "TIENDA ONLINE")}</div><div class="web">${esc(c.web)}</div><div class="esc">${esc(c.qrLeyenda ?? "Escanee el código para comprar online.")}</div></div></div></div>`
}

async function main() {
  const [archivoConfig, salidaArg, copias = "1"] = process.argv.slice(2)
  if (!archivoConfig || !salidaArg) {
    console.error("Uso: marca.ts <config.json> <salida-sin-extension> [copias]")
    process.exit(1)
  }
  const config = JSON.parse(readFileSync(archivoConfig, "utf8")) as Config
  const logo = readFileSync(resolve(dirname(archivoConfig), config.logo), "utf8")
  const qrcode = requerirExterno<{
    toString(t: string, o: Record<string, unknown>): Promise<string>
  }>("qrcode")
  const qr = await qrcode.toString(config.qr, { type: "svg", errorCorrectionLevel: "M", margin: 0 })

  const salida = resolve(salidaArg)
  writeFileSync(`${salida}.html`, html(config, logo, qr))
  if (!existsSync(CHROME)) throw new Error(`No está Chrome en ${CHROME} (defina CHROME_PATH).`)
  execFileSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${ANCHO_MM * PUNTOS_POR_MM},${ALTO_MM * PUNTOS_POR_MM}`,
    `--screenshot=${salida}.png`,
    `file://${salida}.html`,
  ], { stdio: "ignore" })
  writeFileSync(
    `${salida}.tspl`,
    await pngATspl(`${salida}.png`, {
      anchoMm: ANCHO_MM,
      altoMm: ALTO_MM,
      gapMm: config.gapMm,
      densidad: config.densidad,
      copias: Math.max(1, Number(copias) || 1),
    }),
  )
  console.log(`listo: ${salida}.png (vista previa) y ${salida}.tspl`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

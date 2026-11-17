/**
 * Dibujo en canvas (navegador) de las etiquetas que van como BITMAP, y de la vista previa del
 * 29x20. Las mismas funciones alimentan la vista previa y la impresión. Nada toca el DOM al
 * importar: `ajustarTexto` y `moduloQr` son puros y se testean sin DOM.
 */
import { matrizQr } from "./qr"
import { QR6, type FilaTspl, type HojaQr } from "./trabajos"

/** px por mm de la impresora (203 dpi). */
const PUNTOS_POR_MM = 8

// Posiciones dentro de la celda de 400x400 del QR 6 por hoja (la hoja que aprobó la usuaria).
const QR_ARRIBA = 35
const NOMBRE_Y = 318
const WEB_Y = 358
const ANCHO_TEXTO = 360
const NOMBRE_MIN_PX = 18
const FUENTE = "Arial, Helvetica, sans-serif"

/**
 * Texto que entra en `maxAncho`: baja la fuente de `pxInicial` hasta `pxMin` y, si aun así no
 * entra, lo corta con elipsis. `medir(texto, px)` devuelve el ancho en px (measureText).
 */
export function ajustarTexto(
  texto: string,
  maxAncho: number,
  pxInicial: number,
  pxMin: number,
  medir: (texto: string, px: number) => number,
): { texto: string; px: number } {
  const t = texto.trim()
  for (let px = pxInicial; px >= pxMin; px--) {
    if (medir(t, px) <= maxAncho) return { texto: t, px }
  }
  let corto = t
  while (corto.length > 0 && medir(corto + "…", pxMin) > maxAncho) corto = corto.slice(0, -1)
  return { texto: corto.trimEnd() + "…", px: pxMin }
}

/** Módulo entero (px) para que el QR de `n` módulos ocupe a lo sumo `lado` px sin suavizado. */
export function moduloQr(n: number, lado: number): number {
  return Math.max(1, Math.floor(lado / n))
}

function lienzo(ancho: number, alto: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas")
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("El navegador no permite dibujar la etiqueta.")
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, ancho, alto)
  ctx.imageSmoothingEnabled = false
  return { canvas, ctx }
}

function dibujarMatriz(ctx: CanvasRenderingContext2D, matriz: boolean[][], x: number, y: number, modulo: number) {
  ctx.fillStyle = "#000"
  matriz.forEach((fila, f) =>
    fila.forEach((negro, c) => {
      if (negro) ctx.fillRect(x + c * modulo, y + f * modulo, modulo, modulo)
    }),
  )
}

/** Hoja de 800x1200 con hasta 6 celdas de 400x400 (borde punteado, QR, nombre y web). */
export async function dibujarHojaQr6(hoja: HojaQr): Promise<ImageData> {
  const { ctx } = lienzo(QR6.anchoLienzo, QR6.altoLienzo)
  const matrices = await Promise.all(hoja.celdas.map((c) => (c ? matrizQr(c.url) : null)))
  hoja.celdas.forEach((celda, i) => {
    const matriz = matrices[i]
    if (!celda || !matriz) return
    const centro = celda.x + celda.ancho / 2

    ctx.save()
    ctx.strokeStyle = "#000"
    ctx.lineWidth = QR6.bordePx
    ctx.setLineDash([12, 8])
    ctx.strokeRect(celda.x + 1, celda.y + 1, celda.ancho - 2, celda.alto - 2)
    ctx.restore()

    const modulo = moduloQr(matriz.length, QR6.qr)
    const lado = modulo * matriz.length
    dibujarMatriz(ctx, matriz, Math.round(centro - lado / 2), celda.y + QR_ARRIBA + Math.floor((QR6.qr - lado) / 2), modulo)

    ctx.fillStyle = "#000"
    ctx.textAlign = "center"
    ctx.textBaseline = "alphabetic"
    const medir = (t: string, px: number) => {
      ctx.font = `bold ${px}px ${FUENTE}`
      return ctx.measureText(t).width
    }
    const nombre = ajustarTexto(celda.nombre, ANCHO_TEXTO, QR6.nombrePx, NOMBRE_MIN_PX, medir)
    ctx.font = `bold ${nombre.px}px ${FUENTE}`
    ctx.fillText(nombre.texto, centro, celda.y + NOMBRE_Y)

    ctx.font = `${QR6.webPx}px ${FUENTE}`
    ctx.fillText(celda.web, centro, celda.y + WEB_Y, ANCHO_TEXTO)
  })
  return ctx.getImageData(0, 0, QR6.anchoLienzo, QR6.altoLienzo)
}

/**
 * Vista previa de una fila del rollo 29x20 (100x20 mm = 800x160 puntos) a partir de los BAR/TEXT
 * del trabajo real. La fuente "2" de la impresora es de 12x20 puntos: se dibuja carácter por
 * carácter en monoespaciada para respetar las posiciones.
 */
export function dibujarFilaCodigos(fila: FilaTspl): ImageData {
  const ancho = 100 * PUNTOS_POR_MM
  const alto = 20 * PUNTOS_POR_MM
  const { ctx } = lienzo(ancho, alto)
  ctx.fillStyle = "#000"
  for (const b of fila.barras) ctx.fillRect(b.x, b.y, b.ancho, b.alto)
  ctx.font = `bold 18px "Courier New", monospace`
  ctx.textBaseline = "top"
  ctx.textAlign = "left"
  for (const t of fila.textos) {
    ;[...t.texto].forEach((c, i) => ctx.fillText(c, t.x + i * 12, t.y + 1, 12))
  }
  return ctx.getImageData(0, 0, ancho, alto)
}

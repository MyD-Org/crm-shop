/**
 * Dibujo en canvas (navegador) de las etiquetas que van como BITMAP, y de la vista previa del
 * 29x20. Las mismas funciones alimentan la vista previa y la impresión. Nada toca el DOM al
 * importar: `ajustarTexto` y `moduloQr` son puros y se testean sin DOM.
 */
import { matrizQr } from "./qr"
import { PRECIO4, QR6, type CeldaPrecio, type FilaTspl, type HojaPrecio, type HojaQr } from "./trabajos"

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

/** Mayor tamaño de fuente (px, entre `pxMin` y `pxMax`) con el que `texto` entra en `maxAncho`. */
export function pxQueEntra(
  texto: string,
  maxAncho: number,
  pxMax: number,
  pxMin: number,
  medir: (texto: string, px: number) => number,
): number {
  for (let px = pxMax; px > pxMin; px--) if (medir(texto, px) <= maxAncho) return px
  return pxMin
}

// Etiqueta de precio 4 por hoja: cada celda de 400x600 de la hoja se dibuja GIRADA 90°, así la
// etiqueta se lee apaisada (75x50 mm = 600x400 en su propio sistema).
export const CELDA_PRECIO4 = { ancho: 600, alto: 400, util: 560 } as const
const P4_NOMBRE_PX = 40
const P4_NOMBRE_MIN_PX = 26
const P4_GRANDE_MAX_PX = 200
const P4_GRANDE_MIN_PX = 40
const P4_ROTULO_PX = 30
const P4_LISTA_PX = 46
const P4_SEP_NOMBRE = 24
const P4_SEP_PIE = 24
const P4_ESPACIO_PIE = 20

export interface TextoCelda {
  texto: string
  px: number
  peso: "bold" | "normal"
  /** x del borde izquierdo e y del centro vertical, en el sistema 600x400 de la etiqueta. */
  x: number
  y: number
}

/**
 * Posiciones (puras) de los textos de una etiqueta de precio 4 por hoja en su sistema apaisado de
 * 600x400: nombre en un renglón (achica y, si no entra, corta con …), el precio grande lo más
 * grande que entre en 560 de ancho y, abajo, "con transferencia" chico y "Lista $X" mediano en el
 * mismo renglón. Todo centrado horizontal y el bloque centrado vertical. `medir(texto, px, peso)`
 * devuelve el ancho (measureText).
 */
export function textosCeldaPrecio4(
  celda: Pick<CeldaPrecio, "nombre" | "grande" | "rotulo" | "lista">,
  medir: (texto: string, px: number, peso: "bold" | "normal") => number,
): TextoCelda[] {
  const { ancho, alto, util } = CELDA_PRECIO4
  const negrita = (t: string, px: number) => medir(t, px, "bold")
  const nombre = ajustarTexto(celda.nombre, util, P4_NOMBRE_PX, P4_NOMBRE_MIN_PX, negrita)
  const grandePx = pxQueEntra(celda.grande, util, P4_GRANDE_MAX_PX, P4_GRANDE_MIN_PX, negrita)
  const pie = celda.rotulo != null && celda.lista != null ? { rotulo: celda.rotulo, lista: celda.lista } : null
  const anchoRotulo = pie ? medir(pie.rotulo, P4_ROTULO_PX, "normal") : 0
  const listaPx = pie ? pxQueEntra(pie.lista, util - anchoRotulo - P4_ESPACIO_PIE, P4_LISTA_PX, 16, negrita) : 0
  // Alto de cada renglón (caja) para centrar el bloque.
  const altoNombre = Math.round(nombre.px * 1.2)
  const altoGrande = Math.round(grandePx * 0.9)
  const altoPie = pie ? Math.round(Math.max(listaPx, P4_ROTULO_PX) * 1.2) : 0
  const total = altoNombre + P4_SEP_NOMBRE + altoGrande + (pie ? P4_SEP_PIE + altoPie : 0)
  let y = Math.round((alto - total) / 2)
  const centrado = (texto: string, px: number, peso: "bold" | "normal", yCentro: number): TextoCelda => ({
    texto,
    px,
    peso,
    x: Math.round((ancho - medir(texto, px, peso)) / 2),
    y: yCentro,
  })
  const out: TextoCelda[] = [centrado(nombre.texto, nombre.px, "bold", y + altoNombre / 2)]
  y += altoNombre + P4_SEP_NOMBRE
  out.push(centrado(celda.grande, grandePx, "bold", y + altoGrande / 2))
  y += altoGrande
  if (pie) {
    y += P4_SEP_PIE
    const anchoPie = anchoRotulo + P4_ESPACIO_PIE + medir(pie.lista, listaPx, "bold")
    const x0 = Math.round((ancho - anchoPie) / 2)
    out.push({ texto: pie.rotulo, px: P4_ROTULO_PX, peso: "normal", x: x0, y: y + altoPie / 2 })
    out.push({ texto: pie.lista, px: listaPx, peso: "bold", x: Math.round(x0 + anchoRotulo + P4_ESPACIO_PIE), y: y + altoPie / 2 })
  }
  return out
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
 * Hoja de 800x1200 con hasta 4 celdas de 400x600. Cada etiqueta se dibuja en su sistema apaisado
 * de 600x400 (`textosCeldaPrecio4`) y se gira 90° en sentido horario al pegarla en su celda; las
 * celdas vacías no se dibujan.
 */
export async function dibujarHojaPrecio4(hoja: HojaPrecio): Promise<ImageData> {
  const { ctx } = lienzo(PRECIO4.anchoLienzo, PRECIO4.altoLienzo)
  const medir = (t: string, px: number, peso: "bold" | "normal") => {
    ctx.font = `${peso} ${px}px ${FUENTE}`
    return ctx.measureText(t).width
  }
  for (const celda of hoja.celdas) {
    if (!celda) continue
    // Línea de corte fina, como el borde de la celda del QR 6 por hoja.
    ctx.save()
    ctx.strokeStyle = "#000"
    ctx.lineWidth = PRECIO4.bordePx
    ctx.setLineDash([12, 8])
    ctx.strokeRect(celda.x + 1, celda.y + 1, celda.ancho - 2, celda.alto - 2)
    ctx.restore()

    const textos = textosCeldaPrecio4(celda, medir)
    ctx.save()
    // Origen en la esquina superior derecha de la celda y giro horario: el (0,0) de la etiqueta
    // apaisada (600x400) queda arriba a la derecha y su ancho corre hacia abajo.
    ctx.translate(celda.x + celda.ancho, celda.y)
    ctx.rotate(Math.PI / 2)
    ctx.fillStyle = "#000"
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    for (const t of textos) {
      ctx.font = `${t.peso} ${t.px}px ${FUENTE}`
      ctx.fillText(t.texto, t.x, t.y)
    }
    ctx.restore()
  }
  return ctx.getImageData(0, 0, PRECIO4.anchoLienzo, PRECIO4.altoLienzo)
}

/** Ancho x alto (puntos) de las fuentes internas de la impresora, para la vista previa. */
const FUENTES_VISTA: Record<string, { ancho: number; alto: number }> = {
  "1": { ancho: 8, alto: 12 },
  "2": { ancho: 12, alto: 20 },
  "3": { ancho: 16, alto: 24 },
  "4": { ancho: 24, alto: 32 },
  "5": { ancho: 32, alto: 48 },
}

/**
 * Vista previa de una fila del rollo 29x20 (100x20 mm = 800x160 puntos) a partir de los BAR/TEXT
 * del trabajo real (código de barras o precio). Cada fuente interna tiene un ancho fijo por
 * carácter (la "2" es de 12x20 puntos): se dibuja carácter por carácter en monoespaciada, con su
 * tamaño y multiplicadores, para respetar las posiciones.
 */
export function dibujarFilaCodigos(fila: FilaTspl): ImageData {
  const ancho = 100 * PUNTOS_POR_MM
  const alto = 20 * PUNTOS_POR_MM
  const { ctx } = lienzo(ancho, alto)
  ctx.fillStyle = "#000"
  for (const b of fila.barras) ctx.fillRect(b.x, b.y, b.ancho, b.alto)
  ctx.textBaseline = "top"
  ctx.textAlign = "left"
  for (const t of fila.textos) {
    const f = FUENTES_VISTA[t.fuente] ?? FUENTES_VISTA["2"]
    const w = f.ancho * (t.mx || 1)
    ctx.save()
    // Alto de la fuente ~90 % de la celda; el multiplicador de alto se aplica escalando en y.
    ctx.translate(t.x, t.y + 1)
    ctx.scale(1, t.my || 1)
    ctx.font = `bold ${Math.round(f.alto * 0.9)}px "Courier New", monospace`
    ;[...t.texto].forEach((c, i) => ctx.fillText(c, i * w, 0, w))
    ctx.restore()
  }
  return ctx.getImageData(0, 0, ancho, alto)
}

/**
 * Trabajos TSPL de etiquetas (puros, sin DOM). El 29x20 es un port de
 * `scripts/etiquetas/codigos.ts` (mismas posiciones y comandos); el QR 6 por hoja se arma acá
 * como layout + ensamble de bitmaps, y el dibujo en canvas vive aparte.
 */
import { ascii, cabeceraTspl, comandoBitmap, concatenar, rgbaA1bit, type OpcionesCabecera } from "./bitmap"
import { barras, code128b, MAX_CARACTERES_REFERENCIA, MENSAJES_REFERENCIA, PUNTOS_POR_MM } from "./code128"
import { hostWeb, urlProductoQr } from "./qr"
import { textoImprimible, validarCantidad } from "./texto"

export type TipoEtiqueta = "codigos-29x20" | "precio-29x20" | "qr-6up" | "precio-4up" | "grande"

/** Tipos que imprimen el precio de la tienda web (piden los precios al Shop). */
export const TIPOS_CON_PRECIO: readonly TipoEtiqueta[] = ["precio-29x20", "precio-4up"]
/** Tipos del rollo chico 29x20 (prueba de impresión chica, vista previa de una fila TSPL). */
export const TIPOS_ROLLO_CHICO: readonly TipoEtiqueta[] = ["codigos-29x20", "precio-29x20"]

export interface ItemEtiqueta {
  alegraId: string
  referencia: string | null
  nombre: string
  cantidad: number
}

export interface Omitido {
  alegraId: string
  nombre: string
  motivo: string
}

/** Un flujo de bytes que se manda de una vez a la impresora. */
export interface Trabajo {
  tipo: TipoEtiqueta
  datos: Uint8Array
  etiquetas: number
}

export interface ResultadoTrabajos {
  trabajos: Trabajo[]
  omitidos: Omitido[]
  etiquetas: number
}

export const ROLLOS: Record<TipoEtiqueta, { titulo: string; detalle: string }> = {
  "codigos-29x20": { titulo: "Rollo chico 29x20", detalle: "Cargue el rollo chico 29x20 (3 por fila)." },
  "precio-29x20": { titulo: "Rollo chico 29x20", detalle: "Cargue el rollo chico 29x20 (3 por fila)." },
  "qr-6up": { titulo: "Rollo grande 100x150", detalle: "Cargue el rollo grande 100x150." },
  "precio-4up": { titulo: "Rollo grande 100x150", detalle: "Cargue el rollo grande 100x150." },
  grande: { titulo: "Rollo grande 100x150", detalle: "Cargue el rollo grande 100x150." },
}

// ---------------------------------------------------------------------------
// Código de barras 29x20, tres por fila
// ---------------------------------------------------------------------------

const ANCHO_ETIQUETA = 29 * PUNTOS_POR_MM
const COLUMNAS_MM = [2, 34, 66] // inicio de cada etiqueta con SIZE 100 mm y GAP 2 mm
export const FILAS_POR_TANDA = 10
const ANCHO_CARACTER = 12 // fuente "2"

export const MENSAJE_CODIGO_ANCHO = "El código de barras de la referencia no entra en la etiqueta de 29 mm."

const CABECERA_29X20: OpcionesCabecera = { anchoMm: 100, altoMm: 20, gapMm: 2 }

interface EtiquetaCodigo {
  nombre: string
  referencia: string
  patron: string
}

function fila(etiquetas: EtiquetaCodigo[]): string {
  const L = [cabeceraTspl(CABECERA_29X20) + "CLS"]
  etiquetas.forEach(({ nombre, referencia, patron }, i) => {
    const n = textoImprimible(nombre).slice(0, MAX_CARACTERES_REFERENCIA)
    const r = textoImprimible(referencia)
    const base = COLUMNAS_MM[i] * PUNTOS_POR_MM
    const { ancho } = barras(patron, 0, 0, 0)
    L.push(`TEXT ${base + Math.floor((ANCHO_ETIQUETA - n.length * ANCHO_CARACTER) / 2)},20,"2",0,1,1,"${n}"`)
    L.push(...barras(patron, base + Math.floor((ANCHO_ETIQUETA - ancho) / 2), 46, 64).comandos)
    L.push(`TEXT ${base + Math.floor((ANCHO_ETIQUETA - r.length * ANCHO_CARACTER) / 2)},118,"2",0,1,1,"${r}"`)
  })
  L.push("PRINT 1,1")
  return L.join("\r\n") + "\r\n"
}

export const MENSAJE_CODIGO_ANCHO_SIN_SUFIJO =
  "El código de barras de la referencia no entra en la etiqueta de 29 mm, ni siquiera sin el sufijo."

export type CodigoDeBarras =
  | { ok: true; codigo: string; patron: string; sinSufijo: boolean }
  | { ok: false; mensaje: string }

function entraEn29mm(codigo: string): string | null {
  if (codigo.length > MAX_CARACTERES_REFERENCIA) return null
  const patron = code128b(codigo)
  return barras(patron, 0, 0, 0).ancho > ANCHO_ETIQUETA - 16 ? null : patron
}

/**
 * Qué se codifica en el código de barras de una referencia. Si la referencia completa no entra
 * en 29 mm, se prueba sin el sufijo de marca (lo que sigue al último guion): Alegra busca por
 * coincidencia parcial, así que "VOLKAN-BLACK-40" encuentra "VOLKAN-BLACK-40-GRS".
 */
export function codigoDeBarras(referencia: string | null): CodigoDeBarras {
  if (referencia == null || referencia.trim() === "") return { ok: false, mensaje: MENSAJES_REFERENCIA.vacia }
  if (!/^[\x20-\x7e]+$/.test(referencia)) return { ok: false, mensaje: MENSAJES_REFERENCIA.caracteres }
  const ref = referencia
  const completo = entraEn29mm(ref)
  if (completo) return { ok: true, codigo: ref, patron: completo, sinSufijo: false }
  const guion = ref.lastIndexOf("-")
  const base = guion > 0 ? ref.slice(0, guion) : ""
  const sinSufijo = base ? entraEn29mm(base) : null
  if (sinSufijo) return { ok: true, codigo: base, patron: sinSufijo, sinSufijo: true }
  return { ok: false, mensaje: base ? MENSAJE_CODIGO_ANCHO_SIN_SUFIJO : MENSAJE_CODIGO_ANCHO }
}

/**
 * Etiquetas 29x20 con Code128 de la referencia: 3 por fila, cada unidad de cantidad es una
 * etiqueta, tandas de a lo sumo 10 filas por trabajo. Los productos que no se pueden imprimir
 * se omiten (una vez por producto) con el motivo para mostrar en pantalla.
 */
export function trabajoCodigos(items: ItemEtiqueta[]): ResultadoTrabajos {
  const omitidos: Omitido[] = []
  const etiquetas: EtiquetaCodigo[] = []
  for (const item of items) {
    const omitir = (motivo: string) => omitidos.push({ alegraId: item.alegraId, nombre: item.nombre, motivo })
    const cant = validarCantidad(item.cantidad)
    if (!cant.ok) {
      omitir(cant.mensaje)
      continue
    }
    const cod = codigoDeBarras(item.referencia)
    if (!cod.ok) {
      omitir(cod.mensaje)
      continue
    }
    for (let k = 0; k < item.cantidad; k++) etiquetas.push({ nombre: item.nombre, referencia: cod.codigo, patron: cod.patron })
  }

  return { trabajos: enTandas(etiquetas, "codigos-29x20", fila), omitidos, etiquetas: etiquetas.length }
}

/** Filas de 3 etiquetas en tandas de a lo sumo FILAS_POR_TANDA filas: un trabajo por tanda. */
function enTandas<T>(etiquetas: T[], tipo: TipoEtiqueta, armarFila: (fila: T[]) => string): Trabajo[] {
  const filas: T[][] = []
  for (let i = 0; i < etiquetas.length; i += COLUMNAS_MM.length) filas.push(etiquetas.slice(i, i + COLUMNAS_MM.length))
  const trabajos: Trabajo[] = []
  for (let k = 0; k < filas.length; k += FILAS_POR_TANDA) {
    const tanda = filas.slice(k, k + FILAS_POR_TANDA)
    trabajos.push({
      tipo,
      datos: ascii(tanda.map(armarFila).join("")),
      etiquetas: tanda.reduce((n, f) => n + f.length, 0),
    })
  }
  return trabajos
}

// ---------------------------------------------------------------------------
// Precio 29x20, tres por fila (sin código de barras ni referencia)
// ---------------------------------------------------------------------------

/**
 * Precio de un producto tal como lo muestra la card del catálogo del Shop (con IVA), del contrato
 * POST /api/internal/etiquetas/precios del Shop. `precioMedio` = "$X con <Medio>" del medio
 * destacado (`rotulo` = "con Transferencia"); null = la card no tiene esa línea.
 */
export interface PrecioEtiqueta {
  precioLista: number | null
  precioMedio: { nombre: string; rotulo: string; precio: number } | null
}

/** Ancho x alto en puntos de las fuentes internas TSPL que usa la etiqueta de precio. */
export const FUENTES_TSPL: Record<string, { ancho: number; alto: number }> = {
  "1": { ancho: 8, alto: 12 },
  "2": { ancho: 12, alto: 20 },
  "3": { ancho: 16, alto: 24 },
  "4": { ancho: 24, alto: 32 },
  "5": { ancho: 32, alto: 48 },
}

/** Con y < 20 la impresora corta el texto: nada sube de y=24. */
export const PRECIO_Y = { nombre: 24, precio: 44, medio: 96, lista: 116 } as const
/** Caracteres del nombre con la fuente "1" (29 entran; 2 de margen). */
export const MAX_NOMBRE_PRECIO = 27
/** 232 - 8 = 224 puntos útiles para el precio grande (7 caracteres con la fuente "5"). */
const ANCHO_UTIL_PRECIO = ANCHO_ETIQUETA - 8

export const MENSAJE_SIN_PRECIO = "El producto no tiene precio de lista en la tienda."
export const MENSAJE_PRECIO_ANCHO = "El precio no entra en la etiqueta de 29 mm."

/** "$41.310": pesos redondeados, miles con punto, sin decimales ni espacio (lo que entra en 29 mm). */
export function formatoPesos(n: number): string {
  const entero = Math.round(n)
  const signo = entero < 0 ? "-" : ""
  return `${signo}$${String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`
}

/** Un TEXT de la etiqueta de precio, sin la x (se centra al armar la fila). */
export interface RenglonPrecio {
  y: number
  fuente: string
  mx: number
  my: number
  texto: string
}

/**
 * Renglón del precio grande: fuente "5" (32x48) en y=44 si entra en 224 puntos (hasta 7
 * caracteres); si no, "4" con alto doble (24x64), subida a y=36 para quedar centrada en la misma
 * franja que la "5" (44..92, centro 68); si tampoco, "3" con alto doble (16x48) en y=44.
 * null = no entra ni así.
 */
export function renglonPrecio(texto: string): RenglonPrecio | null {
  const opciones: RenglonPrecio[] = [
    { y: PRECIO_Y.precio, fuente: "5", mx: 1, my: 1, texto },
    { y: 36, fuente: "4", mx: 1, my: 2, texto },
    { y: PRECIO_Y.precio, fuente: "3", mx: 1, my: 2, texto },
  ]
  return opciones.find((r) => texto.length * FUENTES_TSPL[r.fuente].ancho * r.mx <= ANCHO_UTIL_PRECIO) ?? null
}

/**
 * Renglones de una etiqueta de precio. Con precio del medio destacado menor al de lista: nombre,
 * precio del medio grande, "con <medio>" y "$X con otros medios" (como la card de la web). Sin medio (o no más barato una vez
 * redondeado): nombre y el precio de lista grande, sin las dos líneas de abajo (lo más simple y
 * sin repetir el mismo precio). `{ ok: false }` = se omite con ese motivo.
 */
export function renglonesPrecio(
  nombre: string,
  precio: PrecioEtiqueta | undefined,
): { ok: true; renglones: RenglonPrecio[] } | { ok: false; mensaje: string } {
  const c = contenidoPrecio(precio)
  if (!c.ok) return c
  const grande = renglonPrecio(c.grande)
  if (!grande) return { ok: false, mensaje: MENSAJE_PRECIO_ANCHO }
  const renglones: RenglonPrecio[] = [
    { y: PRECIO_Y.nombre, fuente: "1", mx: 1, my: 1, texto: textoImprimible(nombre).slice(0, MAX_NOMBRE_PRECIO).trim() },
    grande,
  ]
  if (c.rotulo && c.lista) {
    renglones.push({ y: PRECIO_Y.medio, fuente: "1", mx: 1, my: 1, texto: textoImprimible(c.rotulo).slice(0, MAX_NOMBRE_PRECIO).trim() })
    // Fuente "1": "$45.900 con otros medios" no entra en 232 puntos con la "2".
    renglones.push({ y: PRECIO_Y.lista, fuente: "1", mx: 1, my: 1, texto: c.lista })
  }
  return { ok: true, renglones: renglones.filter((r) => r.texto !== "") }
}

/** Textos de una etiqueta de precio (cualquier tamaño): el precio grande y, con medio, las dos líneas de abajo. */
export type ContenidoPrecio =
  | { ok: true; grande: string; rotulo: string | null; lista: string | null }
  | { ok: false; mensaje: string }

/**
 * Qué dice una etiqueta de precio. Con precio del medio destacado menor al de lista (ya
 * redondeados): el del medio grande, "con efectivo" (`ROTULO_LOCAL`) y "$X con otros medios" (como la card). Sin
 * medio, o no más barato: sólo el de lista grande (`rotulo` y `lista` null). Sin precio de lista:
 * se omite con el motivo.
 */
export function contenidoPrecio(precio: PrecioEtiqueta | undefined): ContenidoPrecio {
  if (!precio || precio.precioLista == null || !(precio.precioLista > 0)) return { ok: false, mensaje: MENSAJE_SIN_PRECIO }
  const lista = formatoPesos(precio.precioLista)
  const medio = precio.precioMedio
  if (medio == null || !(medio.precio > 0) || Math.round(medio.precio) >= Math.round(precio.precioLista)) {
    return { ok: true, grande: lista, rotulo: null, lista: null }
  }
  return {
    ok: true,
    grande: formatoPesos(medio.precio),
    // En el local el precio del medio destacado se cobra en efectivo: la etiqueta dice "con efectivo"
    // aunque la web lo rotule con el medio ("con Transferencia").
    rotulo: ROTULO_LOCAL,
    lista: `${lista} con otros medios`,
  }
}

/** Rótulo del precio grande en las etiquetas de precio (góndola del local). */
export const ROTULO_LOCAL = "con efectivo"

function filaPrecio(etiquetas: RenglonPrecio[][]): string {
  const L = [cabeceraTspl(CABECERA_29X20) + "CLS"]
  etiquetas.forEach((renglones, i) => {
    const base = COLUMNAS_MM[i] * PUNTOS_POR_MM
    for (const r of renglones) {
      const ancho = r.texto.length * FUENTES_TSPL[r.fuente].ancho * r.mx
      L.push(`TEXT ${base + Math.floor((ANCHO_ETIQUETA - ancho) / 2)},${r.y},"${r.fuente}",0,${r.mx},${r.my},"${r.texto}"`)
    }
  })
  L.push("PRINT 1,1")
  return L.join("\r\n") + "\r\n"
}

/**
 * Etiquetas de precio 29x20: 3 por fila y tandas de 10 filas, como las de código. `precios` sale
 * del Shop (los mismos de la card, por alegraId); sin precio de lista el producto se omite con el
 * motivo, una vez por producto.
 */
export function trabajoPrecios(items: ItemEtiqueta[], precios: Record<string, PrecioEtiqueta>): ResultadoTrabajos {
  const omitidos: Omitido[] = []
  const etiquetas: RenglonPrecio[][] = []
  for (const item of items) {
    const omitir = (motivo: string) => omitidos.push({ alegraId: item.alegraId, nombre: item.nombre, motivo })
    const cant = validarCantidad(item.cantidad)
    if (!cant.ok) {
      omitir(cant.mensaje)
      continue
    }
    const r = renglonesPrecio(item.nombre, precios[item.alegraId])
    if (!r.ok) {
      omitir(r.mensaje)
      continue
    }
    for (let k = 0; k < item.cantidad; k++) etiquetas.push(r.renglones)
  }
  return { trabajos: enTandas(etiquetas, "precio-29x20", filaPrecio), omitidos, etiquetas: etiquetas.length }
}

// ---------------------------------------------------------------------------
// QR 6 por hoja (100x150): layout puro + ensamble de bitmaps
// ---------------------------------------------------------------------------

export const QR6 = {
  anchoLienzo: 800,
  altoLienzo: 1200,
  celda: 400,
  columnas: 2,
  filas: 3,
  qr: 250,
  nombrePx: 25,
  webPx: 22,
  bordePx: 2,
} as const

export const CELDAS_POR_HOJA = QR6.columnas * QR6.filas

export const CABECERA_100X150: Required<OpcionesCabecera> = { anchoMm: 100, altoMm: 150, gapMm: 3, densidad: 10 }

export interface CeldaQr {
  x: number
  y: number
  ancho: number
  alto: number
  alegraId: string
  nombre: string
  url: string
  web: string
}

export interface HojaQr {
  /** Siempre CELDAS_POR_HOJA posiciones; null = celda vacía (sin borde). */
  celdas: (CeldaQr | null)[]
}

export type ResultadoLayoutQr =
  | { ok: true; hojas: HojaQr[]; omitidos: Omitido[]; etiquetas: number }
  | { ok: false; mensaje: string }

/** Distribuye una celda por unidad de cantidad en hojas de 2x3; la última se completa con vacías. */
export function layoutQr6(items: ItemEtiqueta[], shopUrl: string | null | undefined): ResultadoLayoutQr {
  const base = urlProductoQr(shopUrl, "")
  if (!base.ok) return base
  const web = hostWeb((shopUrl as string).trim())
  const omitidos: Omitido[] = []
  const unidades: Omit<CeldaQr, "x" | "y" | "ancho" | "alto">[] = []
  for (const item of items) {
    const cant = validarCantidad(item.cantidad)
    if (!cant.ok) {
      omitidos.push({ alegraId: item.alegraId, nombre: item.nombre, motivo: cant.mensaje })
      continue
    }
    const r = urlProductoQr(shopUrl, item.alegraId)
    if (!r.ok) return r
    for (let k = 0; k < item.cantidad; k++) unidades.push({ alegraId: item.alegraId, nombre: item.nombre, url: r.url, web })
  }
  const hojas: HojaQr[] = []
  for (let i = 0; i < unidades.length; i += CELDAS_POR_HOJA) {
    const celdas: (CeldaQr | null)[] = []
    for (let j = 0; j < CELDAS_POR_HOJA; j++) {
      const u = unidades[i + j]
      celdas.push(
        u
          ? { ...u, x: (j % QR6.columnas) * QR6.celda, y: Math.floor(j / QR6.columnas) * QR6.celda, ancho: QR6.celda, alto: QR6.celda }
          : null,
      )
    }
    hojas.push({ celdas })
  }
  return { ok: true, hojas, omitidos, etiquetas: unidades.length }
}

export interface Imagen1Bit {
  bytes: Uint8Array
  anchoBytes: number
  alto: number
}

/** Un trabajo con una cabecera y, por imagen, CLS + BITMAP a pantalla completa + PRINT 1,1. */
export function ensamblarTrabajoBitmap(opciones: OpcionesCabecera, imagenes: Imagen1Bit[]): Uint8Array {
  const partes: Uint8Array[] = [ascii(cabeceraTspl(opciones))]
  for (const img of imagenes) {
    partes.push(ascii("CLS\r\n"), comandoBitmap(0, 0, img.anchoBytes, img.alto, img.bytes), ascii("\r\nPRINT 1,1\r\n"))
  }
  return concatenar(partes)
}

/** Píxeles RGBA de una hoja dibujada (lo que devuelve `getImageData`). */
export interface PixelesRgba {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type ResultadoTrabajosQr = ({ ok: true } & ResultadoTrabajos) | { ok: false; mensaje: string }

/**
 * QR 6 por hoja (100x150, GAP 3 mm, DENSITY 10): un trabajo por hoja (un BITMAP + PRINT 1,1),
 * así ningún envío pasa de ~120 KB. `dibujar` rasteriza la hoja (canvas.ts en el navegador; un
 * doble en los tests): es la misma función que alimenta la vista previa.
 */
export async function trabajoQr6(
  items: ItemEtiqueta[],
  shopUrl: string | null | undefined,
  dibujar: (hoja: HojaQr) => Promise<PixelesRgba>,
): Promise<ResultadoTrabajosQr> {
  const layout = layoutQr6(items, shopUrl)
  if (!layout.ok) return layout
  const trabajos: Trabajo[] = []
  for (const hoja of layout.hojas) {
    const px = await dibujar(hoja)
    const { bytes, anchoBytes } = rgbaA1bit(px.data, px.width, px.height)
    trabajos.push({
      tipo: "qr-6up",
      datos: ensamblarTrabajoBitmap(CABECERA_100X150, [{ bytes, anchoBytes, alto: px.height }]),
      etiquetas: hoja.celdas.filter(Boolean).length,
    })
  }
  return { ok: true, trabajos, omitidos: layout.omitidos, etiquetas: layout.etiquetas }
}

// ---------------------------------------------------------------------------
// Precio 4 por hoja (100x150): layout puro + ensamble de bitmaps, como el QR 6 por hoja. Cada
// celda (400x600 en la hoja) lleva una etiqueta apaisada de 75x50 mm dibujada girada 90° (canvas.ts).
// ---------------------------------------------------------------------------

export const PRECIO4 = {
  anchoLienzo: 800,
  altoLienzo: 1200,
  celdaAncho: 400,
  celdaAlto: 600,
  columnas: 2,
  filas: 2,
  bordePx: 2,
} as const

export const CELDAS_PRECIO_POR_HOJA = PRECIO4.columnas * PRECIO4.filas

export interface CeldaPrecio {
  x: number
  y: number
  ancho: number
  alto: number
  alegraId: string
  /** Texto original (el canvas dibuja tildes y ñ). */
  nombre: string
  /** "$41.310": el del medio destacado o, sin medio, el de lista. */
  grande: string
  /** "con efectivo"; null = sin medio (sólo el precio de lista). */
  rotulo: string | null
  /** "$45.900 con otros medios"; null = sin medio. */
  lista: string | null
}

export interface HojaPrecio {
  /** Siempre CELDAS_PRECIO_POR_HOJA posiciones; null = celda vacía (no se dibuja). */
  celdas: (CeldaPrecio | null)[]
}

/**
 * Una celda por unidad de cantidad en hojas de 2x2 (400x600 px cada una); la última se completa
 * con vacías. Mismos precios y mismos omitidos que la etiqueta de precio 29x20 (`contenidoPrecio`).
 */
export function layoutPrecio4(
  items: ItemEtiqueta[],
  precios: Record<string, PrecioEtiqueta>,
): { hojas: HojaPrecio[]; omitidos: Omitido[]; etiquetas: number } {
  const omitidos: Omitido[] = []
  const unidades: Omit<CeldaPrecio, "x" | "y" | "ancho" | "alto">[] = []
  for (const item of items) {
    const omitir = (motivo: string) => omitidos.push({ alegraId: item.alegraId, nombre: item.nombre, motivo })
    const cant = validarCantidad(item.cantidad)
    if (!cant.ok) {
      omitir(cant.mensaje)
      continue
    }
    const c = contenidoPrecio(precios[item.alegraId])
    if (!c.ok) {
      omitir(c.mensaje)
      continue
    }
    for (let k = 0; k < item.cantidad; k++) {
      unidades.push({ alegraId: item.alegraId, nombre: item.nombre.trim(), grande: c.grande, rotulo: c.rotulo, lista: c.lista })
    }
  }
  const hojas: HojaPrecio[] = []
  for (let i = 0; i < unidades.length; i += CELDAS_PRECIO_POR_HOJA) {
    const celdas: (CeldaPrecio | null)[] = []
    for (let j = 0; j < CELDAS_PRECIO_POR_HOJA; j++) {
      const u = unidades[i + j]
      celdas.push(
        u
          ? {
              ...u,
              x: (j % PRECIO4.columnas) * PRECIO4.celdaAncho,
              y: Math.floor(j / PRECIO4.columnas) * PRECIO4.celdaAlto,
              ancho: PRECIO4.celdaAncho,
              alto: PRECIO4.celdaAlto,
            }
          : null,
      )
    }
    hojas.push({ celdas })
  }
  return { hojas, omitidos, etiquetas: unidades.length }
}

/**
 * Precio 4 por hoja (100x150, GAP 3 mm, DENSITY 10): un trabajo por hoja (un BITMAP + PRINT 1,1).
 * `dibujar` rasteriza la hoja (canvas.ts en el navegador; un doble en los tests): es la misma
 * función que alimenta la vista previa.
 */
export async function trabajoPrecio4(
  items: ItemEtiqueta[],
  precios: Record<string, PrecioEtiqueta>,
  dibujar: (hoja: HojaPrecio) => Promise<PixelesRgba>,
): Promise<ResultadoTrabajos> {
  const layout = layoutPrecio4(items, precios)
  const trabajos: Trabajo[] = []
  for (const hoja of layout.hojas) {
    const px = await dibujar(hoja)
    const { bytes, anchoBytes } = rgbaA1bit(px.data, px.width, px.height)
    trabajos.push({
      tipo: "precio-4up",
      datos: ensamblarTrabajoBitmap(CABECERA_100X150, [{ bytes, anchoBytes, alto: px.height }]),
      etiquetas: hoja.celdas.filter(Boolean).length,
    })
  }
  return { trabajos, omitidos: layout.omitidos, etiquetas: layout.etiquetas }
}

// ---------------------------------------------------------------------------
// Vista previa del 29x20: la primera fila leída del MISMO TSPL que se envía
// ---------------------------------------------------------------------------

export interface FilaTspl {
  barras: { x: number; y: number; ancho: number; alto: number }[]
  /** `fuente` = fuente interna TSPL ("1".."5"); `mx`/`my` = multiplicadores de ancho y alto. */
  textos: { x: number; y: number; texto: string; fuente: string; mx: number; my: number }[]
}

/** BAR y TEXT del primer bloque CLS…PRINT de un trabajo de texto TSPL. */
export function primeraFilaTspl(tspl: string): FilaTspl {
  const fila: FilaTspl = { barras: [], textos: [] }
  for (const linea of tspl.split("\r\n")) {
    if (linea.startsWith("PRINT")) break
    const bar = /^BAR (\d+),(\d+),(\d+),(\d+)$/.exec(linea)
    if (bar) {
      const [x, y, ancho, alto] = bar.slice(1).map(Number)
      fila.barras.push({ x, y, ancho, alto })
      continue
    }
    const txt = /^TEXT (\d+),(\d+),"([^"]*)",\d+,(\d+),(\d+),"(.*)"$/.exec(linea)
    if (txt) {
      fila.textos.push({
        x: Number(txt[1]),
        y: Number(txt[2]),
        fuente: txt[3],
        mx: Number(txt[4]),
        my: Number(txt[5]),
        texto: txt[6],
      })
    }
  }
  return fila
}

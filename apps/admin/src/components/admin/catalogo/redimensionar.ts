/**
 * Redimensiona una imagen EN EL NAVEGADOR antes de subirla.
 *
 * Se hace acá y no en el servidor por dos motivos: el archivo va directo del navegador a R2 con
 * una URL firmada, así que nunca pasa por Vercel (y no choca con el tope de 4,5 MB de body); y
 * una foto de celular de 4 MB se convierte en tres webp que suman menos de 400 KB, que es lo que
 * de verdad importa en una vidriera.
 */

/** Anchos que se generan por foto. Tienen que coincidir con ANCHOS_FOTO del servidor. */
export const ANCHOS = [320, 800, 1600] as const

export interface VarianteLista {
  ancho: number
  blob: Blob
}

export const TIPOS_ACEPTADOS = ["image/jpeg", "image/png", "image/webp", "image/avif"]

/** Tope del archivo ORIGINAL que se acepta del disco, antes de redimensionar. */
export const MAX_BYTES_ORIGINAL = 25 * 1024 * 1024

export class ImagenInvalida extends Error {}

async function cargar(file: File): Promise<ImageBitmap> {
  try {
    // createImageBitmap respeta la orientación EXIF; sin esto las fotos de celular salen rotadas.
    return await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    throw new ImagenInvalida("No pudimos leer esa imagen. Pruebe con un archivo JPG, PNG o WEBP.")
  }
}

/**
 * Devuelve una variante por cada ancho, en webp.
 *
 * Nunca AGRANDA: si la foto original mide menos que un ancho pedido, esa variante se genera al
 * tamaño real. Estirar una imagen chica sólo suma peso y la hace ver peor.
 */
export async function generarVariantes(file: File): Promise<VarianteLista[]> {
  if (!TIPOS_ACEPTADOS.includes(file.type)) {
    throw new ImagenInvalida("El archivo no es una imagen. Use JPG, PNG o WEBP.")
  }
  if (file.size > MAX_BYTES_ORIGINAL) {
    throw new ImagenInvalida("La imagen pesa demasiado. Use una de hasta 25 MB.")
  }

  const bitmap = await cargar(file)
  try {
    const salida: VarianteLista[] = []
    // Se recorre ANCHOS y se saltean los repetidos DESPUÉS de recortar contra el ancho real, para
    // no generar dos veces la misma imagen cuando la foto original es más chica que una variante.
    const yaGenerados = new Set<number>()

    for (const nominal of ANCHOS) {
      const ancho = Math.min(nominal, bitmap.width)
      if (yaGenerados.has(ancho)) continue
      yaGenerados.add(ancho)

      const alto = Math.max(1, Math.round((bitmap.height * ancho) / bitmap.width))
      const canvas = document.createElement("canvas")
      canvas.width = ancho
      canvas.height = alto
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new ImagenInvalida("Su navegador no pudo procesar la imagen.")
      ctx.drawImage(bitmap, 0, 0, ancho, alto)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82))
      if (!blob) throw new ImagenInvalida("Su navegador no pudo procesar la imagen.")

      // El ancho que se REPORTA es el nominal, no el real: es la etiqueta con la que el servidor
      // arma la key y con la que la tienda elige variante.
      salida.push({ ancho: nominal, blob })
    }
    return salida
  } finally {
    bitmap.close()
  }
}

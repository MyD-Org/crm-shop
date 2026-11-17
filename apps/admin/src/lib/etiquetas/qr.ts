/** URL y matriz de los códigos QR que llevan a la ficha del producto en el Shop. */

export const MENSAJE_SIN_SHOP_URL = "No se puede armar el código QR porque la tienda no tiene dirección web."

export type ResultadoUrl = { ok: true; url: string } | { ok: false; mensaje: string }

/** `${shopUrl}/producto/${alegraId}` sin barra doble y con el id codificado (p. ej. "mdp:12"). */
export function urlProductoQr(shopUrl: string | null | undefined, alegraId: string): ResultadoUrl {
  const base = (shopUrl ?? "").trim().replace(/\/+$/, "")
  if (!base) return { ok: false, mensaje: MENSAJE_SIN_SHOP_URL }
  return { ok: true, url: `${base}/producto/${encodeURIComponent(alegraId)}` }
}

/** Host de la tienda para imprimir como texto ("tienda.cliente.example"). */
export function hostWeb(shopUrl: string): string {
  try {
    return new URL(shopUrl).host
  } catch {
    return shopUrl.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "")
  }
}

/**
 * Matriz de módulos del QR (true = negro), nivel de corrección M. `qrcode` se importa a demanda
 * para no sumarlo al bundle de otras páginas.
 */
export async function matrizQr(url: string): Promise<boolean[][]> {
  const QRCode = await import("qrcode")
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" })
  return Array.from({ length: modules.size }, (_, fila) =>
    Array.from({ length: modules.size }, (_, col) => Boolean(modules.get(fila, col))),
  )
}

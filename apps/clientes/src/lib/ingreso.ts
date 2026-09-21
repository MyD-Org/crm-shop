/**
 * URL de ingreso que vuelve a donde estaba el comprador. Módulo PURO.
 *
 * Antes las páginas protegidas hacían `redirect("/ingresar")` a secas. Clerk no
 * sabía a dónde volver y caía en su destino por defecto: quien iniciaba sesión
 * para pagar terminaba en el panel, lejos del checkout, con el carrito
 * esperando en otra pestaña mental. `redirect_url` es el parámetro que el
 * componente `<SignIn>` de Clerk respeta, y sobrevive al ida y vuelta de Google.
 */

/**
 * ¿Es un destino al que podemos mandar al usuario después de loguearse?
 *
 * Solo rutas internas. Aceptar cualquier cosa convierte el login en un open
 * redirect: alguien arma `/ingresar?redirect_url=https://sitio-falso.com`, la
 * víctima se loguea en el sitio real y termina en uno que le pide la tarjeta.
 *
 * `//dominio.com` es la trampa clásica: empieza con `/` pero el navegador lo
 * trata como otro host. `/\\` es su variante con barra invertida.
 */
export function destinoSeguro(destino: string | null | undefined): string {
  if (!destino) return "/";
  if (!destino.startsWith("/")) return "/";
  if (destino.startsWith("//") || destino.startsWith("/\\")) return "/";
  // No volver al propio login: sería un bucle.
  if (destino === "/ingresar" || destino.startsWith("/ingresar/") || destino.startsWith("/ingresar?")) {
    return "/";
  }
  return destino;
}

/** `/ingresar?redirect_url=<destino>`, con el destino ya saneado. */
export function rutaIngreso(destino: string): string {
  const seguro = destinoSeguro(destino);
  if (seguro === "/") return "/ingresar";
  return `/ingresar?redirect_url=${encodeURIComponent(seguro)}`;
}

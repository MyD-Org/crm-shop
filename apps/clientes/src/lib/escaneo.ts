/**
 * Qué hacer con lo que leyó el escáner del buscador. Puro, para testear sin cámara.
 *
 * - Un link a la ficha de un producto (el QR de las etiquetas del CRM: `<tienda>/producto/<id>`)
 *   va directo a la ficha. Se mira sólo el camino, no el dominio: la etiqueta impresa con la URL de
 *   producción también sirve en staging o en local.
 * - Otro link no es de la tienda: no se sigue.
 * - Cualquier otro texto es un código (la referencia del Code128 de las etiquetas o el EAN del
 *   fabricante): se busca como código del producto.
 */
export type DestinoEscaneo =
  | { tipo: "producto"; id: string }
  | { tipo: "codigo"; codigo: string }
  | { tipo: "invalido" };

const RUTA_PRODUCTO = /^\/producto\/([^/?#]+)\/?$/;

export function destinoEscaneo(leido: string): DestinoEscaneo {
  const texto = leido.trim();
  if (!texto) return { tipo: "invalido" };
  if (/^https?:\/\//i.test(texto)) {
    try {
      const m = RUTA_PRODUCTO.exec(new URL(texto).pathname);
      return m ? { tipo: "producto", id: decodeURIComponent(m[1]) } : { tipo: "invalido" };
    } catch {
      return { tipo: "invalido" };
    }
  }
  // Un código no tiene saltos de línea ni es un párrafo: el QR de una vCard o de un texto largo no lo es.
  if (/\s{2,}|[\r\n]/.test(texto) || texto.length > 64) return { tipo: "invalido" };
  return { tipo: "codigo", codigo: texto };
}

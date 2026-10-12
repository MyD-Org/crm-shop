/**
 * Flag `variantes-selector` (change `variantes-de-producto`). Se lee sólo en el server, por request,
 * y NUNCA dentro de `use cache`: viaja como argumento (`agrupar`) a las consultas del catálogo, así
 * que es parte de la clave de las cachés y prenderlo o apagarlo se ve en la vista siguiente.
 *
 * Apagado (default): el Shop se comporta exactamente como antes de las variantes. El listado muestra
 * una card por producto (cada variante es una card), el overlay se lee del propio producto y el
 * carrito, el pedido y los favoritos no cambian. (El padre de un modelo nunca es vendible, con o sin
 * flag: la vista del CRM ya lo deja `activo = false`.)
 * Prendido: el listado muestra sólo el representante de cada modelo (`es_representante`) y el overlay
 * (nombre, fotos, ficha, visibilidad) se lee del ancla del grupo (`overlay_alegra_id`). El selector
 * de la ficha llega en la rebanada siguiente.
 *
 * Antes de prenderlo hay que haber corrido en el CRM `variantes-recalcular` y
 * `variantes-adoptar-overlay` (un grupo sin overlay en el ancla queda invisible: fail-closed).
 *
 * Vive en Vercel Flags (key `variantes-selector`, ver src/flags.ts): se cambia sin redeploy. Si no se
 * puede evaluar, se asume apagado.
 */
import { variantesSelectorFlag } from "@/flags";

export async function variantesSelector(): Promise<boolean> {
  try {
    return (await variantesSelectorFlag()) === true;
  } catch {
    return false;
  }
}

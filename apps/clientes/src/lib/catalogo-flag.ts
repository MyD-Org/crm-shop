/**
 * Flag de visibilidad del catálogo: con él encendido, los listados públicos
 * (catálogo, facetas, home y autocompletado) sólo muestran productos con
 * `catalog_overlay.visible = true` curados en el admin del CRM.
 *
 * FAIL-CLOSED: el overlay es esparso y `visible` arranca en false; un producto
 * sin fila de overlay queda afuera. Encenderlo antes de curar el catálogo en el
 * CRM deja la tienda VACÍA. Por eso el default es apagado y se enciende sólo
 * con la curaduría hecha (ver docs/catalogo-overlay.md).
 *
 * Se lee sólo en el server. Vive en Vercel Flags (key `catalogo-solo-visibles`,
 * ver src/flags.ts): se cambia sin redeploy.
 */
import { catalogoSoloVisiblesFlag } from "@/flags";

export async function catalogoSoloVisibles(): Promise<boolean> {
  return catalogoSoloVisiblesFlag();
}

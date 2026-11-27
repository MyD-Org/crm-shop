import { redirect } from "next/navigation";
import { HREF_OFERTAS } from "@/lib/catalogo-url";

/**
 * `/ofertas`: dirección corta para la barra de arriba, el menú y el bloque de la home. Es el
 * catálogo con «Solo ofertas» y «Mayor descuento» (misma grilla, chips y filtros), así que redirige
 * ahí en vez de duplicar la página. Sin campañas vigentes, el catálogo dice «Por ahora no hay ofertas».
 */
export default function OfertasPage(): never {
  redirect(HREF_OFERTAS);
}

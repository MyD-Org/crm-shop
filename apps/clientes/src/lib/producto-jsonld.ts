import type { Product } from "@/data/products";

/**
 * JSON-LD `Product` de la ficha (Rich Results de Google, WhatsApp/Slack no lo
 * usan: eso es `producto-metadata.ts`). Función PURA: la arma
 * `producto/[id]/page.tsx` con el mismo `producto` que ya resolvió
 * `productoDe` (misma consulta cacheada, sin pegarle de nuevo a la base) y la
 * serializa en un `<script type="application/ld+json">`.
 *
 * Reglas:
 * - Precio: el final con impuestos que ve el cliente en la card
 *   (`PrecioConImpuestos` = `precioFinal ?? price`). Sin precio publicado
 *   (`price` 0 o sin cargar en Alegra, mismo criterio que "Consulte el
 *   precio" en ProductoClient) NO se emite `offers`: no hay nada que ofrecer.
 * - `url`: absoluta, armada a mano con `NEXT_PUBLIC_SITE_URL` — a diferencia
 *   de `producto-metadata.ts` (que resuelve relativas contra `metadataBase`
 *   del layout), el JSON-LD es JSON plano sin ese resolver, así que una ruta
 *   relativa quedaría inválida para Google. Sin la env, se omite.
 * - `image`: fotos del overlay del CRM, ya absolutas y filtradas a los hosts
 *   permitidos (`catalogo-medios.ts`). Sin fotos, sin `image` (nunca se
 *   inventa la imagen general del sitio: esa es sólo para la vista previa del
 *   link, no para el structured data).
 */

export interface JsonLdProduct {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  sku?: string;
  mpn?: string;
  brand?: { "@type": "Brand"; name: string };
  image?: string[];
  description?: string;
  category?: string;
  offers?: {
    "@type": "Offer";
    price: number;
    priceCurrency: "ARS";
    availability: "https://schema.org/InStock" | "https://schema.org/OutOfStock";
    url?: string;
  };
}

/** Recorte del texto plano de la descripción: nada de tags ni párrafos larguísimos en el structured data. */
const LARGO_MAXIMO_DESCRIPCION = 500;

function descripcionPlana(descripcion: string | undefined): string | undefined {
  const texto = descripcion?.replace(/\s+/g, " ").trim();
  if (!texto) return undefined;
  return texto.length > LARGO_MAXIMO_DESCRIPCION
    ? `${texto.slice(0, LARGO_MAXIMO_DESCRIPCION).trimEnd()}…`
    : texto;
}

/** Arma el `Product` de JSON-LD. `siteUrl` = `NEXT_PUBLIC_SITE_URL` (sin barra final), undefined si no está configurada. */
export function jsonLdProducto(producto: Product, siteUrl: string | undefined): JsonLdProduct {
  const ruta = `/producto/${encodeURIComponent(producto.id)}`;
  const url = siteUrl ? `${siteUrl.replace(/\/$/, "")}${ruta}` : undefined;
  const precioFinal = producto.precioFinal ?? producto.price;
  const conPrecio = producto.price > 0;
  const descripcion = descripcionPlana(producto.description);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: producto.name,
    ...(producto.sku ? { sku: producto.sku, mpn: producto.sku } : {}),
    ...(producto.brand ? { brand: { "@type": "Brand", name: producto.brand } } : {}),
    ...(producto.images?.length ? { image: producto.images.map((img) => img.url) } : {}),
    ...(descripcion ? { description: descripcion } : {}),
    ...(producto.category ? { category: producto.category } : {}),
    ...(conPrecio
      ? {
          offers: {
            "@type": "Offer",
            price: precioFinal,
            priceCurrency: "ARS",
            availability:
              producto.stock === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
            ...(url ? { url } : {}),
          },
        }
      : {}),
  };
}

/**
 * JSON-LD serializado y escapado contra `</script>`, listo para
 * `dangerouslySetInnerHTML` (ver la guía de Next, "How to implement JSON-LD").
 */
export function jsonLdProductoHtml(producto: Product, siteUrl: string | undefined): string {
  return JSON.stringify(jsonLdProducto(producto, siteUrl)).replace(/</g, "\\u003c");
}

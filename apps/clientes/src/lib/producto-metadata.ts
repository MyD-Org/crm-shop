import type { Metadata } from "next";
import type { Product } from "@/data/products";

/**
 * Metadata de la ficha: lo que muestran WhatsApp, Google y compañía al pegar el
 * link. Next la pone en el `<head>` para los bots de vista previa (WhatsApp,
 * facebookexternalhit, Slackbot…) aunque la página sea dinámica.
 *
 * Canonical y `og:url` solo con `NEXT_PUBLIC_SITE_URL` (el `metadataBase` del
 * layout): relativos sin base rompen el build (mismo criterio que /catalogo).
 */
export function metadataProducto(producto: Product, conBase: boolean): Metadata {
  const ruta = `/producto/${encodeURIComponent(producto.id)}`;
  const partes = [producto.brand, producto.sku && `Código ${producto.sku}`].filter(Boolean);
  const description = partes.length > 0 ? partes.join(" · ") : undefined;
  const portada = producto.images?.[0];

  return {
    title: producto.name,
    description,
    ...(conBase ? { alternates: { canonical: ruta } } : {}),
    openGraph: {
      type: "website",
      title: producto.name,
      description,
      ...(conBase ? { url: ruta } : {}),
      ...(portada
        ? { images: [{ url: portada.url, width: portada.w, alt: portada.alt || producto.name }] }
        : {}),
    },
  };
}

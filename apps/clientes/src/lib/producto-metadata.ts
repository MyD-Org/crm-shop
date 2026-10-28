import type { Metadata } from "next";
import type { Product } from "@/data/products";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import { fmtPrecio } from "@/lib/format";
import { IMAGEN_SITIO, openGraphDelSitio } from "@/lib/metadata-marca";

/**
 * Metadata de la ficha: lo que muestran WhatsApp, Google y compañía al pegar el
 * link. Next la pone en el `<head>` para los bots de vista previa (WhatsApp,
 * facebookexternalhit, Slackbot…) aunque la página sea dinámica.
 *
 * Canonical y `og:url` solo con `NEXT_PUBLIC_SITE_URL` (el `metadataBase` del
 * layout): relativos sin base rompen el build (mismo criterio que /catalogo).
 *
 * Sin foto, la imagen general del sitio (src/app/opengraph-image.tsx): el
 * `openGraph` de la ficha reemplaza entero al del layout, así que si no se la
 * nombra acá el link se comparte sin imagen. También pide la base. Por lo mismo
 * repite `og:site_name` y `og:locale` del sitio (`openGraphDelSitio`).
 *
 * La descripción empieza por el precio: es lo primero que quiere ver quien recibe
 * el link, y WhatsApp muestra sólo el comienzo de la descripción. Es el mismo precio
 * que la card y el JSON-LD (`precioFinal ?? price`, con IVA si se conoce); sin
 * precio publicado ("Consulte el precio") no se pone ninguno. Ojo: el que comparte
 * y Meta guardan la vista previa un tiempo, así que un link viejo puede mostrar un
 * precio anterior.
 */
export function metadataProducto(producto: Product, conBase: boolean, nombreTienda: string): Metadata {
  // Un modelo con variantes tiene UNA dirección canónica: la de su representante (las demás
  // opciones comparten ficha; ver `variantes-selector`).
  const ruta = `/producto/${encodeURIComponent(producto.grupo?.representanteId ?? producto.id)}`;
  const precio = producto.price > 0 ? fmtPrecio(producto.precioFinal ?? producto.price) : undefined;
  const partes = [precio, producto.brand, producto.sku && `Código ${producto.sku}`].filter(Boolean);
  const description = partes.length > 0 ? partes.join(" · ") : undefined;
  const portada = producto.images?.[0];
  // Sólo para mostrar: `producto.name` (el dato real) no se toca.
  const { nombre } = nombreConMarca(
    producto.name,
    producto.brand ? formatMarca(producto.brand) : undefined
  );

  return {
    title: nombre,
    description,
    ...(conBase ? { alternates: { canonical: ruta } } : {}),
    openGraph: {
      ...openGraphDelSitio(nombreTienda),
      title: nombre,
      description,
      ...(conBase ? { url: ruta } : {}),
      ...(portada
        ? { images: [{ url: portada.url, width: portada.w, alt: portada.alt || nombre }] }
        : conBase
          ? { images: [{ url: IMAGEN_SITIO, width: 1200, height: 630, alt: nombre }] }
          : {}),
    },
  };
}

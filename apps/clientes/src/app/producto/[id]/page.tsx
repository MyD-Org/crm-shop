import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { productoPublico } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { metadataProducto } from "@/lib/producto-metadata";
import { ProductoClient } from "@/components/ProductoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";

type Props = { params: Promise<{ id: string }> };

/**
 * Una sola lectura por request: la comparten la metadata y la página. Sale de
 * la caché compartida del catálogo (tag `catalogo`); el flag
 * `catalogo-solo-visibles` se evalúa acá, por request, y viaja en la clave.
 * El precio y el stock que se cobran NO salen de acá: el carrito y el pedido
 * cotizan del espejo en vivo.
 */
const productoDe = cache(async (id: string) => {
  const { soloVisibles } = await flagsPublicos();
  return productoPublico(id, soloVisibles);
});

/** Vista previa del link (WhatsApp, Google…). Ver src/lib/producto-metadata.ts. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const producto = await productoDe((await params).id);
  if (!producto) return {};
  return metadataProducto(producto, Boolean(process.env.NEXT_PUBLIC_SITE_URL));
}

export default async function ProductoPage({ params }: Props) {
  const { id } = await params;
  // En paralelo: la oferta de cuotas no depende del producto (motor sólo-monto).
  const [producto, oferta] = await Promise.all([productoDe(id), getOfertaCuotas()]);

  if (!producto) notFound();

  return <ProductoClient producto={producto} oferta={oferta} />;
}

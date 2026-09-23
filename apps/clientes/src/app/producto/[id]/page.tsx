import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProducto } from "@/lib/catalog";
import { metadataProducto } from "@/lib/producto-metadata";
import { ProductoClient } from "@/components/ProductoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";

// Lee el producto del espejo en cada request (stock y overlay cambian con la sync).
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Una sola consulta por request: la comparten la metadata y la página. */
const productoDe = cache((id: string) => getProducto(id));

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

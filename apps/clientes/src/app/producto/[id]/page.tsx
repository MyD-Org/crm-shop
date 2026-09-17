import { notFound } from "next/navigation";
import { getProducto } from "@/lib/catalog";
import { ProductoClient } from "@/components/ProductoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";

// Lee el producto de Alegra en cada request.
export const dynamic = "force-dynamic";

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // En paralelo: la oferta de cuotas no depende del producto (motor sólo-monto).
  const [producto, oferta] = await Promise.all([getProducto(id), getOfertaCuotas()]);

  if (!producto) notFound();

  return <ProductoClient producto={producto} oferta={oferta} />;
}

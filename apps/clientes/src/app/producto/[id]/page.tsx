import { notFound } from "next/navigation";
import { getProducto } from "@/lib/catalog";
import { ProductoClient } from "@/components/ProductoClient";

// Lee el producto de Alegra en cada request.
export const dynamic = "force-dynamic";

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const producto = await getProducto(id);

  if (!producto) notFound();

  return <ProductoClient producto={producto} />;
}

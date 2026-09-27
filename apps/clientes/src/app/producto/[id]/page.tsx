import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { productoPublico, rutaCategoriaPublica } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { metadataProducto } from "@/lib/producto-metadata";
import { jsonLdProductoHtml } from "@/lib/producto-jsonld";
import { ProductoClient } from "@/components/ProductoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { envioHabilitado } from "@/lib/envio-flag";
import { RelacionadosProducto } from "@/components/producto/RelacionadosProducto";

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
  const [producto, oferta, envio, { soloVisibles }] = await Promise.all([
    productoDe(id),
    getOfertaCuotas(),
    envioHabilitado(),
    flagsPublicos(),
  ]);

  if (!producto) notFound();
  // Migas: la categoría del admin con sus padres. Sin ella, la de Alegra.
  const rutaCategorias = producto.categoriaPropiaId ? await rutaCategoriaPublica(producto.categoriaPropiaId) : [];

  return (
    <>
      {/* Structured data (Rich Results de Google): ver src/lib/producto-jsonld.ts. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdProductoHtml(producto, process.env.NEXT_PUBLIC_SITE_URL),
        }}
      />
      <ProductoClient
        producto={producto}
        oferta={oferta}
        envio={envio}
        rutaCategorias={rutaCategorias}
        relacionados={
          producto.categoriaPropiaId || producto.category ? (
            <Suspense fallback={null}>
              <RelacionadosProducto
                categoriaPropiaId={producto.categoriaPropiaId}
                categoria={producto.category}
                productoId={producto.id}
                soloVisibles={soloVisibles}
                oferta={oferta}
              />
            </Suspense>
          ) : null
        }
      />
    </>
  );
}

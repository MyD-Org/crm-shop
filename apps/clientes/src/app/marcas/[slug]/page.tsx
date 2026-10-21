import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ModoEdicionProvider } from "@/components/home/ModoEdicion";
import { PaginaMarcaVista } from "@/components/marcas/PaginaMarcaVista";
import { EdicionMarcaSiAdmin } from "@/components/marcas/edicion/EdicionMarcaSiAdmin";
import { totalProductosMarca } from "@/components/marcas/bloques/ProductosMarca";
import { esAdmin } from "@/lib/auth";
import { getDatosFooter } from "@/lib/home-datos";
import { getMarca } from "@/lib/marca";
import { getPaginaMarca } from "@/lib/marcas/marcas-datos";
import { hrefCotizacion, leerEstadoMarca, metadataMarca } from "@/lib/marcas/vista-marca";

/**
 * Página de una marca (spec 2026-10-20-marcas-tienda-oficial §2-§7). La
 * `PaginaMarca` sale de la caché de la home (tag `home`); los productos, de la
 * del catálogo, en huecos por request. Sin fila, o sin publicar para quien no
 * es admin: 404. El admin ve las ocultas (para armarlas antes de publicar),
 * siempre fuera del índice.
 */
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, query, marca] = await Promise.all([params, searchParams, getMarca()]);
  const pagina = await getPaginaMarca(slug);
  if (!pagina) return {};
  // Una oculta no delata nada (ni nombre ni bajada) en el <head>: para quien no es admin es un 404.
  if (!pagina.publicada) return { robots: { index: false, follow: false } };
  return metadataMarca(pagina, marca.nombre, Object.keys(query).length > 0);
}

export default function PaginaMarcaPage(props: Props) {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex-1" />}>
      <Contenido {...props} />
    </Suspense>
  );
}

async function Contenido({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const pagina = await getPaginaMarca(slug);
  if (!pagina) notFound();
  if (!pagina.publicada && !(await esAdmin())) notFound();

  const estado = leerEstadoMarca(query, pagina);
  const [total, footer] = await Promise.all([totalProductosMarca(pagina), getDatosFooter()]);
  const cotizacion = pagina.bloques.cotizacion;
  const cotizar = cotizacion ? hrefCotizacion(cotizacion, footer.whatsapp) : null;

  return (
    <ModoEdicionProvider>
      <PaginaMarcaVista pagina={pagina} estado={estado} query={query} total={total} cotizar={cotizar} />
      <Suspense fallback={null}>
        <EdicionMarcaSiAdmin slug={pagina.slug} publicada={pagina.publicada} />
      </Suspense>
    </ModoEdicionProvider>
  );
}

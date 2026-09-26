import { Suspense } from "react";
import { HomeClient } from "@/components/HomeClient";
import { DestacadosHome, DestacadosHomeSkeleton } from "@/components/home/DestacadosHome";
import { EdicionSiAdmin } from "@/components/home/EdicionSiAdmin";
import { ModoEdicionProvider } from "@/components/home/ModoEdicion";
import { getContenidoHome } from "@/lib/home-datos";
import { sinCamposOcultos, sinMarcasDeAcento } from "@/data/home-defaults";
import { jsonLdSitioHtml } from "@/lib/sitio-jsonld";

/**
 * Home: contenido administrable desde la home por un admin (server actions en
 * `src/lib/home-acciones.ts`; defaults = diseño aprobado) + productos
 * destacados reales del catálogo con precio y cuotas vigentes. El anuncio,
 * header y footer los provee el layout raíz.
 *
 * Shell estático (Cache Components): el contenido sale de `getContenidoHome`
 * (`'use cache'`, tag `home`). Lo que es por request va en huecos: los
 * destacados (catálogo, cuotas y sus flags) y el editor.
 *
 * Editor: la página es la misma para todos. No calcula `esAdmin()`: eso lo
 * resuelve el hueco `EdicionSiAdmin` (dentro de `<Suspense fallback={null}>`),
 * que para un admin prende el modo edición y monta la barra. Los datos de cada
 * sección los pide el Dialog al abrirse (`leerSeccionParaEditar`).
 */
export default async function Home() {
  const contenido = await getContenidoHome();
  const { cantidad, skus = [] } = contenido.destacados;
  const secDestacados = sinCamposOcultos(contenido.destacados);
  const label = sinMarcasDeAcento(secDestacados.titulo ?? "") || "Productos destacados";
  const jsonLdSitio = jsonLdSitioHtml(process.env.NEXT_PUBLIC_SITE_URL);

  return (
    <ModoEdicionProvider>
      {/* Structured data de la tienda (Organization + WebSite): ver src/lib/sitio-jsonld.ts. */}
      {jsonLdSitio && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSitio }} />}
      <HomeClient
        contenido={contenido}
        destacados={
          <Suspense fallback={<DestacadosHomeSkeleton label={label} cantidad={cantidad} />}>
            <DestacadosHome
              label={label}
              cantidad={cantidad}
              skus={skus}
              imagenes={secDestacados.imagenes ?? []}
            />
          </Suspense>
        }
      />
      <Suspense fallback={null}>
        <EdicionSiAdmin visibilidad={contenido.visibilidad} />
      </Suspense>
    </ModoEdicionProvider>
  );
}

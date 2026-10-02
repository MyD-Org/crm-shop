import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { productoPublico, rutaCategoriaPublica } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { metadataProducto } from "@/lib/producto-metadata";
import { jsonLdProductoHtml } from "@/lib/producto-jsonld";
import { ProductoClient } from "@/components/ProductoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { CONFIG_ENVIO_DEFAULT, textoEnvioFicha } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { RelacionadosProducto } from "@/components/producto/RelacionadosProducto";
import { dispCatalogo, dispDelVisitante } from "@/lib/zona-servidor";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { disponibilidadParaMostrar } from "@/lib/disponibilidad-vista";
import { usarAtributosEstructurados } from "@/lib/catalogo-atributos-uso";
import { estadoEnvio } from "@/lib/disponibilidad-textos";
import { EnvioProductoUbicacion } from "@/components/producto/EnvioProductoUbicacion";

type Props = { params: Promise<{ id: string }> };

/**
 * Una sola lectura por request: la comparten la metadata y la página. Sale de
 * la caché compartida del catálogo (tag `catalogo`); el flag
 * `catalogo-solo-visibles` se evalúa acá, por request, y viaja en la clave.
 * El precio y el stock que se cobran NO salen de acá: el carrito y el pedido
 * cotizan del espejo en vivo.
 */
const productoDe = cache(async (id: string) => {
  // Con el flag `disponibilidad-sucursal`, `disp` es el del catálogo: igual para todos (stock en
  // cualquier local, sin lo que ninguna sucursal ofrece). Sin flag: undefined.
  // Tabla "Características" (fichas estructuradas, fase 2): sólo con el flag `busqueda-ia` y con
  // `catalog_atributos` legible; si no, la ficha de siempre (sin la tabla).
  const [{ soloVisibles }, disp, estructurados] = await Promise.all([
    flagsPublicos(),
    dispCatalogo(),
    usarAtributosEstructurados(),
  ]);
  return productoPublico(id, soloVisibles, disp, estructurados);
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
  const [producto, oferta, reglas, { soloVisibles }, disp, dispEntrega] = await Promise.all([
    productoDe(id),
    getOfertaCuotas(),
    reglasVentaCacheadas(),
    flagsPublicos(),
    dispCatalogo(),
    dispDelVisitante(),
  ]);
  // Local de retiro elegido en "Enviar a" (si la lectura falla, sin local elegido).
  const eleccion = (await ubicacionDelVisitante().catch(() => null))?.eleccion;
  const localElegido = eleccion?.tipo === "retiro" ? (eleccion.sucursal?.slug ?? null) : null;

  if (!producto) notFound();
  // "Retiro en <local>: ..." por cada local y "Envío a domicilio: ..." (sólo con el flag
  // `disponibilidad-sucursal`), sin que el visitante elija nada. El envío usa la zona del visitante
  // (perfil o predeterminada) sólo para el plazo; no cambia qué se ve.
  const disponibilidad = await disponibilidadParaMostrar([producto.id], dispEntrega);
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
        configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
        localElegido={localElegido}
        envioUbicacion={
          // La ubicación sale de la cookie: va en un hueco por request, con la regla general de
          // fallback, para que la ficha siga con su shell estático.
          <Suspense fallback={textoEnvioFicha(reglas.envio ?? CONFIG_ENVIO_DEFAULT)}>
            <EnvioProductoUbicacion
              configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
              plazo={disponibilidad?.productos[producto.id]?.envio ? estadoEnvio(disponibilidad.productos[producto.id].envio!) : null}
            />
          </Suspense>
        }
        disponibilidad={
          disponibilidad?.productos[producto.id]
            ? { producto: disponibilidad.productos[producto.id], locales: disponibilidad.locales }
            : undefined
        }
        rutaCategorias={rutaCategorias}
        relacionados={
          producto.categoriaPropiaId || producto.category ? (
            <Suspense fallback={null}>
              <RelacionadosProducto
                categoriaPropiaId={producto.categoriaPropiaId}
                categoria={producto.category}
                productoId={producto.id}
                soloVisibles={soloVisibles}
                disp={disp}
                oferta={oferta}
              />
            </Suspense>
          ) : null
        }
      />
    </>
  );
}

import { cache, Suspense } from "react";
import { getTarjetasMercadoPago } from "@/lib/pagos/tarjetas-aceptadas-mp";
import { logosTarjetas } from "@/lib/pagos/tarjetas-aceptadas";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { idDeRuta } from "@/lib/id-producto";
import { alternativaDeVariantePublica, productoPublico, rutaCategoriaPublica } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { metadataProducto } from "@/lib/producto-metadata";
import { jsonLdProductoHtml } from "@/lib/producto-jsonld";
import { ProductoClient } from "@/components/ProductoClient";
import { CONFIG_ENVIO_DEFAULT, textoEnvioFicha } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { RelacionadosProducto } from "@/components/producto/RelacionadosProducto";
import { dispCatalogo, dispDelVisitante } from "@/lib/zona-servidor";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { disponibilidadParaMostrar } from "@/lib/disponibilidad-vista";
import { fieldsDeSpec } from "@/lib/catalogo-specs";
import { filasExtras } from "@/lib/catalogo-caracteristicas";
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
  const [{ soloVisibles, variantes, mediosPrecio }, disp, estructurados] = await Promise.all([
    flagsPublicos(),
    dispCatalogo(),
    usarAtributosEstructurados(),
  ]);
  // `variantes` (flag `variantes-selector`): overlay del ancla del grupo; apagado, la llamada de siempre.
  return variantes
    ? productoPublico(id, soloVisibles, disp, estructurados, mediosPrecio?.ficha, mediosPrecio?.cuotas, mediosPrecio?.modal, true)
    : productoPublico(id, soloVisibles, disp, estructurados, mediosPrecio?.ficha, mediosPrecio?.cuotas, mediosPrecio?.modal);
});

/** Vista previa del link (WhatsApp, Google…). Ver src/lib/producto-metadata.ts. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const producto = await productoDe(idDeRuta((await params).id));
  if (!producto) return {};
  return metadataProducto(producto, Boolean(process.env.NEXT_PUBLIC_SITE_URL));
}

export default async function ProductoPage({ params }: Props) {
  const id = idDeRuta((await params).id);
  const [producto, reglas, { soloVisibles, variantes, mediosPrecio }, disp, dispEntrega, tarjetas, fieldsSpec] = await Promise.all([
    productoDe(id),
    reglasVentaCacheadas(),
    flagsPublicos(),
    dispCatalogo(),
    dispDelVisitante(),
    getTarjetasMercadoPago(),
    // Etiquetas y unidades de la spec de la plataforma, para las claves que el Shop no conoce. Se
    // lee acá, por request y fuera de la lectura cacheada del producto; tolera tabla ausente (null).
    fieldsDeSpec("atributos_tecnicos"),
  ]);
  // Local de retiro elegido en "Enviar a" (si la lectura falla, sin local elegido).
  const eleccion = (await ubicacionDelVisitante().catch(() => null))?.eleccion;
  const localElegido = eleccion?.tipo === "retiro" ? (eleccion.sucursal?.slug ?? null) : null;
  // Envío elegido: la dirección guardada (calle y altura) o, si es una localidad, su nombre.
  const envioElegido = eleccion?.tipo === "envio" ? (eleccion.direccion?.calle || eleccion.localidad || null) : null;

  if (!producto) {
    // Variante oculta por el admin o inactiva en Alegra (flag `variantes-selector`): no se muestra
    // como comprable. Si el modelo tiene otra opción disponible, la ficha de esa; si no, 404.
    const alternativa = variantes ? await alternativaDeVariantePublica(id, soloVisibles, disp) : null;
    if (alternativa) redirect(`/producto/${encodeURIComponent(alternativa)}`);
    notFound();
  }
  // "Retiro en <local>: ..." por cada local y "Envío a domicilio: ..." (sólo con el flag
  // `disponibilidad-sucursal`), sin que el visitante elija nada. El envío usa la zona del visitante
  // (perfil o predeterminada) sólo para el plazo; no cambia qué se ve.
  // Con selector de variantes (flag `variantes-selector`), la disponibilidad de TODAS las opciones:
  // elegir otra no vuelve al servidor.
  const idsDisponibilidad = producto.grupo ? producto.grupo.opciones.map((o) => o.id) : [producto.id];
  const disponibilidad = await (variantes
    ? disponibilidadParaMostrar(idsDisponibilidad, dispEntrega, undefined, true)
    : disponibilidadParaMostrar(idsDisponibilidad, dispEntrega));
  const configEnvio = reglas.envio ?? CONFIG_ENVIO_DEFAULT;
  const envioDe = (id: string) => (
    <Suspense fallback={textoEnvioFicha(configEnvio)}>
      <EnvioProductoUbicacion
        configEnvio={configEnvio}
        plazo={disponibilidad?.productos[id]?.envio ? estadoEnvio(disponibilidad.productos[id].envio!) : null}
      />
    </Suspense>
  );
  // Filas de claves nuevas (sólo las declaradas en la spec) a continuación de las conocidas.
  const extras = filasExtras(producto.atributosExtras ?? {}, fieldsSpec);
  const productoVista = extras.length
    ? { ...producto, especificaciones: [...(producto.especificaciones ?? []), ...extras] }
    : producto;
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
        producto={productoVista}
        configEnvio={configEnvio}
        localElegido={localElegido}
        envioElegido={envioElegido}
        // La ubicación sale de la cookie: va en un hueco por request, con la regla general de
        // fallback, para que la ficha siga con su shell estático.
        envioUbicacion={envioDe(producto.id)}
        envioUbicacionPorId={
          producto.grupo ? Object.fromEntries(producto.grupo.opciones.map((o) => [o.id, envioDe(o.id)])) : undefined
        }
        disponibilidad={
          disponibilidad?.productos[producto.id]
            ? { producto: disponibilidad.productos[producto.id], locales: disponibilidad.locales }
            : undefined
        }
        disponibilidadPorId={producto.grupo ? disponibilidad?.productos : undefined}
        localesDisponibilidad={producto.grupo ? disponibilidad?.locales : undefined}
        rutaCategorias={rutaCategorias}
        logosTarjetas={logosTarjetas(tarjetas)}
        relacionados={
          producto.categoriaPropiaId || producto.category ? (
            <Suspense fallback={null}>
              <RelacionadosProducto
                categoriaPropiaId={producto.categoriaPropiaId}
                categoria={producto.category}
                productoId={producto.id}
                soloVisibles={soloVisibles}
                agrupar={variantes}
                disp={disp}
                destacado={mediosPrecio?.destacado}
                cuotas={mediosPrecio?.cuotas}
              />
            </Suspense>
          ) : null
        }
      />
    </>
  );
}

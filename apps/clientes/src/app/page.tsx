import { Suspense } from "react";
import type { Product } from "@/data/products";
import { HomeClient } from "@/components/HomeClient";
import { EdicionSiAdmin } from "@/components/home/EdicionSiAdmin";
import { ModoEdicionProvider } from "@/components/home/ModoEdicion";
import { getContenidoHome, getDatosLegales } from "@/lib/home-datos";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { getCatalogo, getPaginaCatalogo } from "@/lib/catalog";
import { elegirDestacados } from "@/lib/destacados";

/**
 * Home: contenido administrable desde la home por un admin (server actions en
 * `src/lib/home-acciones.ts`; defaults = diseño aprobado) + productos
 * destacados reales del catálogo con precio y cuotas vigentes. El anuncio,
 * header y footer los provee el layout raíz.
 *
 * Destacados: los SKUs curados desde el editor se resuelven primero; el resto
 * se completa con Iluminación (héroes temáticos de la tienda), nunca
 * hardcodeados.
 *
 * Editor: la página es la misma para todos. No calcula `esAdmin()`: eso lo
 * resuelve el hueco `EdicionSiAdmin` (dentro de `<Suspense fallback={null}>`),
 * que para un admin prende el modo edición y monta la barra. Los datos de cada
 * sección los pide el Dialog al abrirse (`leerSeccionParaEditar`).
 *
 * Sin `force-dynamic` a propósito: el layout raíz lee cookies (tema) y eso
 * fuerza render dinámico de todo el árbol, así precio/contenido nunca se
 * congelan en el build.
 */
export default async function Home() {
  // `getDatosLegales` ya lo pide el footer en este mismo request (React
  // `cache`): acá no suma consultas, solo se lo pasa a la barra del admin.
  const [contenido, legal] = await Promise.all([getContenidoHome(), getDatosLegales()]);
  const { cantidad, skus = [] } = contenido.destacados;

  // Si el catálogo falla, la home degrada a destacados vacíos (la sección ya
  // renderiza la grilla vacía) en vez de tumbar la página entera.
  const [oferta, iluminacion, general] = await Promise.all([
    getOfertaCuotas(),
    getPaginaCatalogo({ filtros: { categorias: ["ILUMINACION"] }, pagina: 1 }).catch(
      (): { productos: Product[] } => ({ productos: [] }),
    ),
    // Respaldo para SKUs curados que no sean de Iluminación.
    skus.length ? getCatalogo({ limit: 300 }).catch((): Product[] => []) : Promise.resolve([]),
  ]);

  const vistos = new Set(iluminacion.productos.map((p) => p.id));
  const pool = [...iluminacion.productos, ...general.filter((p) => !vistos.has(p.id))];
  const destacados = elegirDestacados(pool, skus, cantidad);

  return (
    <ModoEdicionProvider>
      <HomeClient oferta={oferta} contenido={contenido} destacados={destacados} />
      <Suspense fallback={null}>
        <EdicionSiAdmin visibilidad={contenido.visibilidad} legal={legal} />
      </Suspense>
    </ModoEdicionProvider>
  );
}

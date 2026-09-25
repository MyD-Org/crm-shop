import type { Product } from "@/data/products";
import { HomeClient } from "@/components/HomeClient";
import { esAdmin } from "@/lib/auth";
import { BarraEdicion } from "@/components/home/BarraEdicion";
import { ModoEdicionProvider } from "@/components/home/ModoEdicion";
import { getContenidoHome, getDatosFooter, getDatosLegales } from "@/lib/home-datos";
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
 * Sin `force-dynamic` a propósito: el layout raíz lee cookies (tema) y eso
 * fuerza render dinámico de todo el árbol, así precio/contenido nunca se
 * congelan en el build.
 */
export default async function Home() {
  const [contenido, puedeEditar] = await Promise.all([getContenidoHome(), esAdmin()]);
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

  if (!puedeEditar) {
    return <HomeClient oferta={oferta} contenido={contenido} destacados={destacados} puedeEditar={false} />;
  }

  const [legal, footer] = await Promise.all([getDatosLegales(), getDatosFooter()]);
  return (
    <ModoEdicionProvider>
      <HomeClient oferta={oferta} contenido={contenido} destacados={destacados} puedeEditar />
      <BarraEdicion
        anuncio={contenido.anuncio}
        navBadge={contenido.navBadge}
        visibilidad={contenido.visibilidad}
        legal={legal}
        footer={footer}
      />
    </ModoEdicionProvider>
  );
}

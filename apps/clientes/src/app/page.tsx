import type { Product } from "@/data/products";
import { HomeClient } from "@/components/HomeClient";
import { getContenidoHome } from "@/lib/home-datos";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { getCatalogo, getPaginaCatalogo } from "@/lib/catalog";
import { elegirDestacados } from "@/lib/destacados";

/**
 * Home: contenido administrable (CRM vía getContenidoHome, defaults = diseño
 * aprobado) + productos destacados reales del catálogo con precio y cuotas
 * vigentes. El anuncio, header y footer los provee el layout raíz.
 *
 * Destacados: los SKUs curados desde el CRM se resuelven primero; el resto se
 * completa con Iluminación (héroes temáticos de la tienda), nunca hardcodeados.
 *
 * Sin `force-dynamic` a propósito: el layout raíz lee cookies (tema) y eso
 * fuerza render dinámico de todo el árbol, así precio/contenido nunca se
 * congelan en el build.
 */
export default async function Home() {
  const contenido = await getContenidoHome();
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

  return <HomeClient oferta={oferta} contenido={contenido} destacados={destacados} />;
}

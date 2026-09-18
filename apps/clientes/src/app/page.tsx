import { HomeClient } from "@/components/HomeClient";
import { getCatalogo } from "@/lib/catalog";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { getContenidoHome } from "@/lib/home-datos";
import type { Product } from "@/data/products";

// La oferta de cuotas y el contenido de home se leen de la DB en cada request:
// no pueden quedar congelados en el build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const contenido = await getContenidoHome();
  const [oferta, destacados] = await Promise.all([
    getOfertaCuotas(),
    // Si el catálogo falla, la home degrada a destacados vacíos (la sección ya
    // renderiza la grilla vacía) en vez de tumbar la página entera.
    getCatalogo({ limit: contenido.destacados.cantidad }).catch(
      (): Product[] => [],
    ),
  ]);
  return (
    <HomeClient oferta={oferta} contenido={contenido} destacados={destacados} />
  );
}

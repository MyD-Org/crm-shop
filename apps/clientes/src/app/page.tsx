import { HomeClient } from "@/components/HomeClient";
import { getCatalogo } from "@/lib/catalog";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { getContenidoHome } from "@/lib/home-datos";

// La oferta de cuotas y el contenido de home se leen de la DB en cada request:
// no pueden quedar congelados en el build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const contenido = await getContenidoHome();
  const [oferta, destacados] = await Promise.all([
    getOfertaCuotas(),
    getCatalogo({ limit: contenido.destacados.cantidad }),
  ]);
  return (
    <HomeClient oferta={oferta} contenido={contenido} destacados={destacados} />
  );
}

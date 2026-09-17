import { getFacetas, getPaginaCatalogo } from "@/lib/catalog";
import { leerEstado, type ParamCrudo } from "@/lib/catalogo-url";
import { CatalogoClient } from "@/components/CatalogoClient";
import { getOfertaCuotas } from "@/lib/cuotas-datos";

// Lee el espejo local del catálogo en cada request (lo refresca el cron diario).
export const dynamic = "force-dynamic";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: ParamCrudo;
    categoria?: ParamCrudo;
    marca?: ParamCrudo;
    orden?: ParamCrudo;
    pagina?: ParamCrudo;
  }>;
}) {
  const estado = leerEstado(await searchParams);

  // Sólo viaja al browser la página pedida. Filtros, orden y conteos se
  // resuelven en Postgres: filtrar u ordenar después de paginar daría
  // resultados incompletos.
  //
  // Las tres lecturas son independientes entre sí:
  // - las facetas cuentan sobre TODO lo que matchea la búsqueda (no sobre lo
  //   ya filtrado), que es lo que hacían cuando se calculaban en el cliente;
  // - la oferta de cuotas es una lectura chica; null (flag apagado, sin datos
  //   o error) ⇒ el catálogo sale sin cuotas.
  const [pagina, facetas, oferta] = await Promise.all([
    getPaginaCatalogo({
      filtros: {
        busqueda: estado.query,
        categorias: estado.categorias,
        marcas: estado.marcas,
      },
      orden: estado.orden,
      pagina: estado.pagina,
    }),
    getFacetas(estado.query),
    getOfertaCuotas(),
  ]);

  return (
    <CatalogoClient
      productos={pagina.productos}
      total={pagina.total}
      paginas={pagina.paginas}
      // La página efectiva, no la pedida: si la URL dice 99 y hay 12, manda 12.
      estado={{ ...estado, pagina: pagina.pagina }}
      facetas={facetas}
      oferta={oferta}
    />
  );
}

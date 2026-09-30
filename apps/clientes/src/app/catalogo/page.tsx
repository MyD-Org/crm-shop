import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { facetasPublicas, paginaCatalogoPublica } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import {
  consultaInterpretada,
  filtrosDeEstado,
  hrefCanonico,
  leerEstado,
  type EstadoCatalogo,
  type ParamCrudo,
} from "@/lib/catalogo-url";
import { indexable } from "@/lib/catalogo-vista";
import { CatalogoClient } from "@/components/CatalogoClient";
import { CatalogoSkeleton } from "@/components/catalogo/CatalogoSkeleton";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { ZonaCatalogo } from "@/components/ZonaCatalogo";
import { dispDelVisitante } from "@/lib/zona-servidor";
import { busquedaIaHabilitada } from "@/lib/busqueda-ia-flag";
import { POCOS_RESULTADOS, debeInterpretar } from "@/lib/busqueda-inteligente/gate";
import { interpretar } from "@/lib/busqueda-inteligente/servidor";
import { hayQueAplicar } from "@/lib/busqueda-inteligente/tipos";
import { chipsSugeridos, hrefInterpretada } from "@/lib/busqueda-inteligente/url";
import { FranjaSugerencias } from "@/components/catalogo/FranjaBusqueda";
import { FranjaSugerenciasServidor } from "@/components/catalogo/FranjaSugerenciasServidor";

type Props = {
  searchParams: Promise<{
    q?: ParamCrudo;
    categoria?: ParamCrudo;
    marca?: ParamCrudo;
    atr?: ParamCrudo;
    orden?: ParamCrudo;
    pagina?: ParamCrudo;
    precio_min?: ParamCrudo;
    precio_max?: ParamCrudo;
    stock?: ParamCrudo;
    vista?: ParamCrudo;
    ia?: ParamCrudo;
  }>;
};

/**
 * SEO de las combinaciones de filtros. Indexan `/catalogo`, una categoría y
 * sus páginas; el resto queda `noindex, follow` (ver `indexable`).
 *
 * El `canonical` necesita una URL absoluta, que sale del `metadataBase` del
 * layout (`NEXT_PUBLIC_SITE_URL`). Sin esa variable se omite: un canonical
 * relativo sin base rompe el build y uno resuelto contra localhost es peor
 * que ninguno.
 */
export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const estado = leerEstado(await searchParams);
  return {
    robots: { index: indexable(estado), follow: true },
    ...(process.env.NEXT_PUBLIC_SITE_URL
      ? { alternates: { canonical: hrefCanonico(estado) } }
      : {}),
  };
}

/**
 * Suspense PARCIAL (sin `loading.tsx`): en la primera carga se ve la silueta
 * del catálogo (`CatalogoSkeleton`) mientras Postgres resuelve; al filtrar,
 * no. La silueta va en el shell estático (Cache Components), así que no lee
 * la URL: los `searchParams` se esperan dentro del hueco. La navegación por `searchParams` es una transición y el segmento de la
 * página conserva su identidad (Next 16.2.9, `layout-router.js`: la clave
 * del segmento se arma SIN los search params), así que React deja la grilla
 * vigente —atenuada por `CatalogoClient`— en lugar de volver al fallback.
 *
 * Plan B si alguna vez el skeleton apareciera al filtrar: sacar el
 * `Suspense` y renderizar `CatalogoResultados` directo (queda sólo el
 * atenuado; se pierde el skeleton de la primera carga).
 */
export default function CatalogoPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<CatalogoSkeleton />}>
      <CatalogoResultados searchParams={searchParams} />
    </Suspense>
  );
}

/** Las lecturas del catálogo y el render del cliente (lo que suspende). */
async function CatalogoResultados({ searchParams }: Props) {
  // `disp`: sucursal de la zona y sus reglas (flag `disponibilidad-sucursal`; undefined = apagado).
  // Viaja como argumento a las lecturas cacheadas: nunca se lee la cookie adentro de la caché.
  const [params, { soloVisibles }, disp, conBusquedaIa] = await Promise.all([
    searchParams,
    flagsPublicos(),
    dispDelVisitante(),
    busquedaIaHabilitada(),
  ]);
  const estado = leerEstado(params);
  // Los mismos filtros para la página y para las facetas: `getFacetas` decide
  // qué grupo excluye en cada conteo. "Solo con stock" viene prendido por
  // defecto (ver `SOLO_STOCK_DEFAULT`).
  // Sin el flag `busqueda-ia`, el panel queda como siempre: sin la faceta de
  // características (ni su consulta).
  const filtros = { ...filtrosDeEstado(estado), ...(conBusquedaIa ? {} : { sinFacetaAtributos: true }) };

  // Sólo viaja al browser la página pedida. Filtros, orden y conteos se
  // resuelven en Postgres: filtrar u ordenar después de paginar daría
  // resultados incompletos. Página y facetas salen de la caché compartida
  // (src/lib/catalogo-publico.ts, tag `catalogo`) salvo búsqueda por texto o
  // rango de precio, que van directo a la base.
  //
  // Las tres lecturas son independientes entre sí:
  // - las facetas cruzan los grupos: las marcas se cuentan dentro de las
  //   categorías tildadas y las categorías dentro de las marcas tildadas, para
  //   que la lista no ofrezca marcas ajenas a lo que se está viendo; el rango
  //   de precio sale del conjunto filtrado sin el propio rango;
  // - la oferta de cuotas es una lectura chica; null (flag apagado, sin datos
  //   o error) ⇒ el catálogo sale sin cuotas.
  const [exacta, facetasExactas, oferta] = await Promise.all([
    paginaCatalogoPublica({
      filtros,
      orden: estado.orden,
      pagina: estado.pagina,
      soloVisibles,
      disp,
    }),
    facetasPublicas(filtros, soloVisibles, disp),
    getOfertaCuotas(),
  ]);
  // Búsqueda sin resultados: segundo intento tolerante a errores de tipeo
  // ("lampra" → "lámpara"). Página y facetas con los MISMOS filtros, para que
  // cuenten el conjunto que se ve. Si falla (p. ej. falta pg_trgm), queda la
  // búsqueda exacta vacía y sigue el camino de `filtrosSinBusqueda`.
  let pagina = exacta;
  let facetasBusqueda = facetasExactas;
  if (exacta.total === 0 && filtros.busqueda?.trim()) {
    const tolerantes = { ...filtros, busquedaTolerante: true };
    const segundo = await Promise.all([
      paginaCatalogoPublica({
        filtros: tolerantes,
        orden: estado.orden,
        pagina: estado.pagina,
        soloVisibles,
        disp,
      }),
      facetasPublicas(tolerantes, soloVisibles, disp),
    ]).catch((err: unknown) => {
      console.error("[catalogo] falló la búsqueda tolerante:", err);
      return null;
    });
    if (segundo && segundo[0].total > 0) [pagina, facetasBusqueda] = segundo;
  }
  // Una búsqueda sin resultados dejaba el panel de filtros vacío ("Sin
  // categorías…"): sin nada para tocar, la única salida era borrar el texto.
  // En ese caso el panel muestra los filtros sin la búsqueda, y tocar uno la
  // quita (ver `filtrosSinBusqueda` en CatalogoClient).
  const filtrosSinBusqueda =
    pagina.total === 0 && Boolean(filtros.busqueda?.trim());
  const facetas = filtrosSinBusqueda
    ? await facetasPublicas({ ...filtros, busqueda: undefined }, soloVisibles, disp)
    : facetasBusqueda;

  // Búsqueda inteligente (flag `busqueda-ia`). Puede redirigir: va afuera de
  // todo try/catch (`redirect` tira).
  const busquedaIa = conBusquedaIa ? await busquedaInteligente(estado, pagina.total) : undefined;

  return (
    <>
      {/* Zona vigente (flag `sucursales`): no cambia qué productos se ven. */}
      <Suspense fallback={null}>
        <ZonaCatalogo />
      </Suspense>
      <CatalogoClient
        productos={pagina.productos}
        total={pagina.total}
        paginas={pagina.paginas}
        // La página efectiva, no la pedida: si la URL dice 99 y hay 12, manda 12.
        estado={{ ...estado, pagina: pagina.pagina }}
        facetas={facetas}
        filtrosSinBusqueda={filtrosSinBusqueda}
        oferta={oferta}
        busquedaIa={busquedaIa}
      />
    </>
  );
}

/**
 * Flujo de la búsqueda inteligente sobre el resultado de la búsqueda clásica
 * (spec catálogo asistido, §4). La clásica ya corrió y se muestra igual; esto
 * sólo se suma.
 *
 * - Con `ia=` en la URL (ya interpretada, o `ia=0` "tal cual") NUNCA se vuelve
 *   a interpretar: es el freno contra el bucle de redirecciones. Si la URL
 *   interpretada no trajo nada, se buscan las alternativas (caché, sin sumar
 *   un uso) para el "sin resultados".
 * - `debeInterpretar` y 0–3 resultados: se interpreta en ESTE request y, si
 *   hay algo para aplicar, `redirect` a la URL interpretada (`ia=<consulta>`):
 *   el primer render ya llega rescatado. Dentro del `<Suspense>` de la página
 *   Next lo resuelve como redirección del lado del cliente.
 * - `debeInterpretar` con resultados: la grilla sale ya y la franja llega por
 *   streaming con los filtros propuestos como chips (nada se aplica solo).
 */
async function busquedaInteligente(estado: EstadoCatalogo, total: number) {
  const q = estado.query;
  if (!estado.ia && q && debeInterpretar(q, total)) {
    if (total >= POCOS_RESULTADOS) {
      return {
        alternativas: [],
        franja: (
          <Suspense fallback={null}>
            <FranjaSugerenciasServidor estado={estado} consulta={q} />
          </Suspense>
        ),
      };
    }
    const interpretacion = await interpretar(q);
    if (interpretacion && hayQueAplicar(interpretacion)) redirect(hrefInterpretada(estado, interpretacion));
    const sugerir = interpretacion ? [interpretacion.sugerir] : [];
    return {
      alternativas: total === 0 ? chipsSugeridos(estado, sugerir, "reemplazar") : [],
      franja: total > 0 ? <FranjaSugerencias consulta={q} chips={chipsSugeridos(estado, sugerir)} /> : undefined,
    };
  }
  const consulta = consultaInterpretada(estado);
  if (consulta && total === 0) {
    const interpretacion = await interpretar(consulta, { sumarUso: false });
    return { alternativas: interpretacion ? chipsSugeridos(estado, [interpretacion.sugerir], "reemplazar") : [] };
  }
  return { alternativas: [] };
}

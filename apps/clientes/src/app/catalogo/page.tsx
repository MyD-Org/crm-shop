import { Suspense } from "react";
import type { Metadata } from "next";
import { categoriasTotalesPublicas, facetasPublicas } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import {
  IA_PLAN,
  filtrosDeEstado,
  hrefCanonico,
  leerEstado,
  sinBusquedaIa,
  type EstadoCatalogo,
  type ParamCrudo,
} from "@/lib/catalogo-url";
import { indexable } from "@/lib/catalogo-vista";
import { CatalogoClient } from "@/components/CatalogoClient";
import { CatalogoSkeleton } from "@/components/catalogo/CatalogoSkeleton";
import { dispCatalogo, dispConStockEn, localesDeRetiro } from "@/lib/zona-servidor";
import type { ContextoDisponibilidad } from "@/lib/disponibilidad-contexto";
import { busquedaIaHabilitada } from "@/lib/busqueda-ia-flag";
import { busquedaMotorUnico } from "@/lib/busqueda-motor-flag";
import { atributosEstructuradosDisponibles } from "@/lib/catalogo-atributos-disponibles";
import { PRODUCTOS_POR_PAGINA, getArbolCategorias } from "@/lib/catalog";
import { chipsSugeridos } from "@/lib/busqueda-inteligente/url";
import { pareceCodigo } from "@/lib/busqueda-inteligente/gate";
import { hrefBuscar } from "@/lib/busqueda-v2/enlaces";
import { sinTexto } from "@/lib/busqueda-v2/motor";
import { buscarEnShop } from "@/lib/busqueda-v2/motor-servidor";
import type { PlanBusqueda } from "@/lib/busqueda-v2/plan";
import { planParaPagina } from "@/lib/busqueda-v2/servidor";

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
    potencia_min?: ParamCrudo;
    potencia_max?: ParamCrudo;
    stock?: ParamCrudo;
    retiro?: ParamCrudo;
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
  const [params, conBusquedaIa] = await Promise.all([searchParams, busquedaIaHabilitada()]);
  const estado = conBusquedaIa ? leerEstado(params) : sinBusquedaIa(leerEstado(params));
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
  // `disp` (flag `disponibilidad-sucursal`; undefined = apagado): el catálogo NO depende de la zona
  // del visitante. "Con stock" = en cualquier local; con `?retiro=<local>`, sólo en ese local. Viaja
  // como argumento a las lecturas cacheadas y es el mismo para todos los visitantes.
  const [params, { soloVisibles, mediosPrecio }, dispGeneral, locales, conBusquedaIa, conMotorUnico] = await Promise.all([
    searchParams,
    flagsPublicos(),
    dispCatalogo(),
    localesDeRetiro(),
    busquedaIaHabilitada(),
    // Flag `busqueda-motor-unico` (apagado = política legado); si no se puede evaluar, apagado.
    busquedaMotorUnico(),
  ]);
  // Flag `busqueda-ia` apagado: igual que antes del cambio (sin `atr` ni `ia`).
  const leido = conBusquedaIa ? leerEstado(params) : sinBusquedaIa(leerEstado(params));
  // Un local desconocido (o el flag apagado) se descarta: el filtro vuelve a "cualquier local".
  const dispLocal = leido.retiroEn ? await dispConStockEn(leido.retiroEn) : undefined;
  const estado = dispLocal ? leido : { ...leido, retiroEn: undefined };
  const disp = dispLocal ?? dispGeneral;
  // Los mismos filtros para la página y para las facetas: `getFacetas` decide
  // qué grupo excluye en cada conteo. "Solo con stock" viene prendido por
  // defecto (ver `SOLO_STOCK_DEFAULT`).
  // Sin el flag `busqueda-ia`, el panel queda como siempre: sin la faceta de
  // características (ni su consulta).
  //
  // Fichas estructuradas (fase 2): con el flag y `catalog_atributos` legible (la migración del CRM
  // puede no estar aplicada), los atributos miran primero el dato estructurado y aparece el filtro
  // de potencia. Sin la tabla, todo como en la fase 1 (y `potencia_*` se ignora).
  const estructurados = conBusquedaIa && (await atributosEstructuradosDisponibles());
  // Una sola búsqueda para las cuatro superficies (`busqueda-v2/motor.ts`): el motor decide las
  // etapas (con `?ia=1`, la URL a la que redirige `/buscar`, el plan de la consulta —caché o
  // recálculo determinista, NUNCA Jev— aporta lo blando; sin resultados, un segundo intento
  // tolerante a errores de tipeo: "lampra" → "lámpara") y devuelve los filtros EFECTIVOS de la
  // etapa que resolvió, para que las facetas cuenten el mismo conjunto que se ve. Nunca se
  // redirige desde acá.
  //
  // Sólo viaja al browser la página pedida. Filtros, orden y conteos se resuelven en Postgres:
  // filtrar u ordenar después de paginar daría resultados incompletos. Página y facetas salen de
  // la caché compartida (src/lib/catalogo-publico.ts, tag `catalogo`) salvo búsqueda por texto o
  // rango de precio, que van directo a la base.
  //
  // Las lecturas son independientes entre sí:
  // - las facetas cruzan los grupos: las marcas se cuentan dentro de las categorías tildadas y
  //   las categorías dentro de las marcas tildadas, para que la lista no ofrezca marcas ajenas a
  //   lo que se está viendo; el rango de precio sale del conjunto filtrado sin el propio rango;
  // - las cuotas sin interés viajan en cada producto (flag `cuotas-cobro`; sin él, ninguna).
  const [pagina, categoriasTotales] = await Promise.all([
    buscarEnShop(
      {
        consulta: estado.query,
        filtros: {
          ...sinTexto(filtrosDeEstado(estado)),
          ...(conBusquedaIa ? {} : { sinFacetaAtributos: true }),
          // Las categorías del panel traen su total fijo (`categoriasTotales`). Sólo con la búsqueda
          // inteligente se siguen contando dentro de la búsqueda, para las sugerencias "+ Afinar".
          ...(conBusquedaIa ? {} : { sinFacetaCategorias: true }),
          ...(estructurados ? { atributosEstructurados: true } : {}),
        },
        orden: estado.orden,
        pagina: estado.pagina,
        porPagina: PRODUCTOS_POR_PAGINA,
      },
      {
        superficie: "catalogo",
        soloVisibles,
        disp,
        destacado: mediosPrecio?.destacado,
        cuotas: mediosPrecio?.cuotas,
        conPlanDeUrl: estado.ia === IA_PLAN,
        conFacetas: true,
        busquedaIa: conBusquedaIa,
        motorUnico: conMotorUnico,
      },
    ),
    // El número de cada categoría del panel: el total del catálogo, no el de la búsqueda ni los
    // filtros. Una sola clave de la caché compartida, para todos los visitantes.
    categoriasTotalesPublicas(soloVisibles, dispGeneral),
  ]);
  const plan = pagina.plan;
  // Una búsqueda sin resultados dejaba el panel de filtros vacío ("Sin
  // categorías…"): sin nada para tocar, la única salida era borrar el texto.
  // En ese caso el panel muestra los filtros sin la búsqueda, y tocar uno la
  // quita (ver `filtrosSinBusqueda` en CatalogoClient).
  const filtrosSinBusqueda = pagina.total === 0 && Boolean(estado.query?.trim());
  const facetas =
    filtrosSinBusqueda || !pagina.facetas
      ? // Sin la búsqueda ni su plan: tocar un filtro quita la búsqueda (y con ella `ia`).
        await facetasPublicas(
          { ...sinTexto(pagina.filtrosEfectivos), ...(conBusquedaIa ? {} : { sinFacetaCategorias: true }) },
          soloVisibles,
          disp,
        )
      : pagina.facetas;

  // Búsqueda inteligente (flag `busqueda-ia`): franja del plan y salidas del "sin resultados".
  const busquedaIa = conBusquedaIa
    ? await busquedaInteligente(estado, pagina.total, plan, {
        soloVisibles,
        disp,
        // Sólo se sugiere lo que deja productos dentro de esta búsqueda (las facetas ya lo cuentan).
        conProductos: new Set([...facetas.categorias, ...facetas.atributos].filter((f) => f.count > 0).map((f) => f.label)),
      })
    : undefined;

  return (
    <>
      <CatalogoClient
        productos={pagina.productos}
        total={pagina.total}
        paginas={pagina.paginas}
        // La página efectiva, no la pedida: si la URL dice 99 y hay 12, manda 12.
        estado={{ ...estado, pagina: pagina.pagina }}
        // El filtro "Con stock en <local>" sólo tiene sentido con más de un local.
        facetas={{ ...facetas, categorias: categoriasTotales, ...(locales.length > 1 ? { locales } : {}) }}
        filtrosSinBusqueda={filtrosSinBusqueda}
        busquedaIa={busquedaIa}
        etapa={pagina.etapa}
      />
    </>
  );
}

/**
 * Lo que la búsqueda inteligente suma a la grilla (búsqueda v2, spec 2026-10-01). La página
 * NUNCA redirige ni llama a Jev: eso lo hace `/buscar` antes de llegar acá.
 *
 * - Con plan (`ia=1`): las sugerencias "+ Afinar" (categorías y atributos blandos que todavía no
 *   son filtro; aplicarlas las vuelve duras vía URL) y la intención (una pregunta destaca al
 *   asesor). Si aun así no hay resultados (los duros solos dan 0), las mismas como alternativas
 *   que reemplazan la búsqueda.
 * - Búsqueda clásica sin resultados (`/catalogo?q=` directo, o `ia=0`): alternativas del plan
 *   determinista (sin Jev, sin escribir nada) y "Ver productos relacionados" → `/buscar`.
 */
async function busquedaInteligente(
  estado: EstadoCatalogo,
  total: number,
  plan: PlanBusqueda | null,
  opciones: { soloVisibles: boolean; disp: ContextoDisponibilidad | undefined; conProductos: Set<string> },
) {
  const blandos = (p: PlanBusqueda) => ({
    categorias: p.blandos.categorias.slice(0, MAX_SUGERENCIAS).map((c) => c.nombre),
    atributos: p.blandos.atributos.map((a) => a.id),
  });
  if (plan) {
    // Un "+ Afinar" que lleva a 0 productos (una categoría vacía) no se ofrece, ni una raíz
    // ("ELECTRICIDAD" no afina nada).
    const raices = new Set((await getArbolCategorias().catch(() => [])).filter((n) => !n.parentId).map((n) => n.nombre));
    const b = blandos(plan);
    const filtros = [
      {
        // Con resultados, las facetas cuentan dentro de la búsqueda; sin ellos, el catálogo sin la
        // búsqueda (donde caen las alternativas, que la reemplazan).
        // Una raíz sí sirve como salida de un "sin resultados".
        categorias: b.categorias.filter((c) => opciones.conProductos.has(c) && (total === 0 || !raices.has(c))),
        atributos: b.atributos.filter((a) => opciones.conProductos.has(a)),
      },
    ];
    return {
      intencion: plan.intencion,
      sugerencias: total > 0 ? chipsSugeridos(estado, filtros).slice(0, MAX_SUGERENCIAS) : [],
      alternativas: total === 0 ? chipsSugeridos(estado, filtros, "reemplazar") : [],
    };
  }
  const q = estado.query;
  if (!q || total > 0 || pareceCodigo(q)) return { sugerencias: [], alternativas: [] };
  const deterministico = await planParaPagina(q, { soloVisibles: opciones.soloVisibles });
  return {
    sugerencias: [],
    alternativas: deterministico
      ? chipsSugeridos(
          estado,
          [
            {
              categorias: blandos(deterministico).categorias.filter((c) => opciones.conProductos.has(c)),
              atributos: blandos(deterministico).atributos.filter((a) => opciones.conProductos.has(a)),
            },
          ],
          "reemplazar",
        )
      : [],
    // Una búsqueda que no pasó por `/buscar` (o se pidió tal cual) puede entenderse ahora.
    ...(estado.ia ? {} : { relacionadosHref: hrefBuscar(q, estado.soloStock) }),
  };
}

/** Tope de chips "+ Afinar" en la franja. */
const MAX_SUGERENCIAS = 4;

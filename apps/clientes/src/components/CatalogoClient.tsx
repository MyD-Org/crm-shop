"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, EmptyState, Pagination } from "@myd-org/ui";
import { CatalogoAvisoLocal } from "@/components/catalogo/CatalogoAvisoLocal";
import { CatalogoChips } from "@/components/catalogo/CatalogoChips";
import { CatalogoControles } from "@/components/catalogo/CatalogoControles";
import { CatalogoEncabezado } from "@/components/catalogo/CatalogoEncabezado";
import { CatalogoFiltros } from "@/components/catalogo/CatalogoFiltros";
import { CatalogoFiltrosSheet } from "@/components/catalogo/CatalogoFiltrosSheet";
import { CatalogoProductos } from "@/components/catalogo/CatalogoProductos";
import { CatalogoSinResultados } from "@/components/catalogo/CatalogoSinResultados";
import { linkNext } from "@/components/catalogo/link-next";
import type { Product } from "@/data/products";
import { usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { aplicarEstadoPrecio } from "@/lib/precios-cuenta-estado";
import type { Facetas } from "@/lib/catalog";
import {
  IA_PLAN,
  estadoConCambios,
  estadoDeBusqueda,
  filtrosDesfasados,
  sinBusquedaIa,
  sinCar,
  hrefCatalogo,
  hrefCon,
  type EstadoCatalogo,
} from "@/lib/catalogo-url";
import { anuncioResultados, hayFiltros, interpretacionVigente, limpiarFiltros } from "@/lib/catalogo-vista";
import type { ChipSugerido } from "@/lib/busqueda-inteligente/url";
import { TEXTOS_SIN_RESULTADOS } from "@/lib/busqueda-inteligente/textos";
import type { Intencion } from "@/lib/busqueda-v2/plan";
import { enviarBusquedaEnviada, enviarClickResultado } from "@/lib/busqueda-v2/telemetria";
import { fijarCatalogoParaChat } from "@/lib/chat-ia-puente";
import { anotarBusqueda } from "@/lib/iniciativa/motor";
import { useChatIa } from "@/hooks/useChatIa";
import { mejorCuotaProducto, type OpcionCuotas } from "@/lib/cuotas-sin-interes";
import { sinResultadosPorLocal } from "@/lib/catalogo-sin-resultados";
import { olvidarLocalRecordado } from "@/lib/local-recordado";
import { useAlOcultar } from "@/lib/use-al-ocultar";

/**
 * UI del catálogo: encabezado, filtros, productos y paginación, todo
 * con componentes de `@myd-org/ui` (ver src/components/catalogo/).
 *
 * El filtrado, el orden y el conteo NO pasan por acá: los resuelve Postgres
 * y llegan resueltos desde `catalogo/page.tsx`. Este componente sólo traduce
 * lo que toca el visitante a una URL nueva, porque el estado del catálogo
 * vive en la query string (ver src/lib/catalogo-url.ts).
 */
export function CatalogoClient({
  productos,
  facetas,
  estado,
  total,
  paginas,
  filtrosSinBusqueda = false,
  sinStock = 0,
  busquedaIa,
  etapa,
  conFacetasPorTipo = false,
  localRecordado,
}: {
  /** Sólo la página actual, nunca el catálogo entero. */
  productos: Product[];
  facetas: Facetas;
  /** Filtros, orden, vista y página vigentes, tal como los leyó el servidor. */
  estado: EstadoCatalogo;
  /** Productos que cumplen los filtros, más allá de esta página. */
  total: number;
  paginas: number;
  /**
   * La búsqueda no encontró nada y `facetas` son las del catálogo sin ella
   * (ver catalogo/page.tsx): tocar un filtro también quita la búsqueda.
   */
  filtrosSinBusqueda?: boolean;
  /**
   * La búsqueda dio 0 con "Solo con stock" (el default), pero incluyendo los sin stock daría esto:
   * el "sin resultados" lo avisa y ofrece verlos. 0 = no aplica.
   */
  sinStock?: number;
  /**
   * Búsqueda inteligente (flag `busqueda-ia`); ausente = catálogo de siempre.
   * - `intencion` y `sugerencias`: del plan de la búsqueda v2 (`?ia=1`), para la franja
   *   (los blandos como "+ Afinar"; una pregunta destaca al asesor).
   * - `alternativas`: lo sugerido para el "sin resultados".
   * - `relacionadosHref`: búsqueda clásica sin resultados → entenderla en `/buscar`.
   */
  busquedaIa?: {
    intencion?: Intencion;
    sugerencias: ChipSugerido[];
    alternativas: ChipSugerido[];
    relacionadosHref?: string;
  };
  /** Etapa del motor de búsqueda que resolvió el listado (sólo telemetría: `busqueda_enviada`). */
  etapa?: string;
  /**
   * Facetas por tipo prendidas (flag `catalogo-facetas-por-tipo` y tabla legible): `?car=` filtra y el
   * panel dibuja `facetas.porClave`. Apagado, `car` de la URL se ignora.
   */
  conFacetasPorTipo?: boolean;
  /**
   * Nombre del local cuando el filtro "Con stock en <local>" se aplicó solo, por el local recordado
   * (cookie) y no por una elección de esta visita: se muestra un aviso con la salida.
   */
  localRecordado?: string;
}) {
  const router = useRouter();
  // Con Cache Components Next no desmonta el catálogo al salir (logo, nav de la home, un
  // producto): lo esconde con `<Activity>` y, al volver por un link, reusa la misma instancia
  // —la clave del segmento no mira los search params— con su estado local. Los filtros tildados
  // salen de la URL y no se arrastran, pero lo que el panel guarda por su cuenta sí (texto de
  // "Buscar marca…", "Ver todas las marcas", categorías abiertas, precio a medio editar). Al
  // salir se cambia `entrada`: el panel se remonta y la próxima entrada arranca limpia. Atrás
  // sigue restaurando los filtros, que viajan en la URL.
  const [entrada, setEntrada] = useState(0);
  useAlOcultar(() => setEntrada((n) => n + 1));
  const sinCarSiApagado = (e: EstadoCatalogo) => (conFacetasPorTipo ? e : sinCar(e));
  // Navegar es un round-trip al servidor: mientras tanto, la grilla se atenúa
  // en vez de quedarse muda.
  const [navegando, startTransition] = useTransition();

  // Al destildar una marca o categoría que no es la última de la URL, Next
  // cambia la URL pero reusa la página vieja sin pedirla (ver
  // `filtrosDesfasados`): el tilde volvía a aparecer y el filtro no se iba.
  // Si la URL del router y lo que renderizó el servidor no coinciden, se
  // muestra lo que dice la URL y se pide la página de nuevo.
  const searchParams = useSearchParams();
  const desfasado = filtrosDesfasados(estado, searchParams, !!busquedaIa, conFacetasPorTipo);
  const claveUrl = searchParams.toString();
  useEffect(() => {
    if (desfasado) startTransition(() => router.refresh());
  }, [desfasado, claveUrl, router]);
  const estadoBase = desfasado
    ? sinCarSiApagado(busquedaIa ? estadoDeBusqueda(searchParams) : sinBusquedaIa(estadoDeBusqueda(searchParams)))
    : estado;

  // Estado optimista: el filtro que toca el visitante se marca en el acto,
  // sin esperar a que el servidor responda con la URL nueva (si no, el tilde
  // aparece recién junto con los resultados y parece que el clic no anduvo).
  // Al terminar la navegación, `estado` ya es el nuevo y el optimista se
  // descarta solo. Clics seguidos se acumulan porque parten de `estadoVisible`.
  const [estadoVisible, marcar] = useOptimistic(estadoBase, estadoConCambios);

  // `ir` puede llamarse dos veces seguidas antes de que React vuelva a
  // renderizar (dos clics rápidos, o un commit del slider seguido de un
  // toggle): si la URL de la segunda se armara con el `estadoVisible` de acá
  // arriba (el del último render), pisaría el cambio de la primera en vez de
  // acumularse, y el filtro quedaba aplicado "a veces sí, a veces no". Por
  // eso la base para el href es esta ref, que se actualiza en cada llamada
  // aunque todavía no haya habido un render de por medio (la hoja de mobile
  // no tiene este problema porque su borrador vive en un `useState` con
  // updater funcional, ver CatalogoFiltrosSheet).
  const panelRef = useRef<HTMLElement>(null);
  const [hayMasAbajo, setHayMasAbajo] = useState(false);
  const [hayMasArriba, setHayMasArriba] = useState(false);
  const medirPanel = () => {
    const el = panelRef.current;
    if (!el) return;
    setHayMasAbajo(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    setHayMasArriba(el.scrollTop > 1);
  };
  // El alto del contenido cambia al expandir marcas o al redimensionar.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    medirPanel();
    const ro = new ResizeObserver(medirPanel);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  const estadoVisibleRef = useRef(estadoVisible);
  useEffect(() => {
    estadoVisibleRef.current = estadoVisible;
  }, [estadoVisible]);

  // Lo que muestra el catálogo, para el contexto de pantalla del chat
  // (`contextoParaChat`, contrato contexto-pantalla-shop/v1).
  useEffect(() => {
    fijarCatalogoParaChat({ estado, total, productos });
    return () => fijarCatalogoParaChat(null);
  }, [estado, total, productos]);

  // Sin `retiro` en el destino, el cliente quitó el filtro de local: se olvida el local
  // recordado para que el proxy no lo vuelva a poner (src/lib/local-recordado.ts).
  const navegar = (href: string) =>
    startTransition(() => {
      olvidarLocalRecordado(href);
      router.push(href);
    });
  const ir = (cambios: Partial<EstadoCatalogo>) =>
    startTransition(() => {
      const siguiente = estadoConCambios(estadoVisibleRef.current, cambios);
      estadoVisibleRef.current = siguiente;
      marcar(cambios);
      const href = hrefCatalogo(siguiente);
      olvidarLocalRecordado(href);
      router.push(href);
    });

  // Precio de la lista privada de la cuenta (cuenta corriente con lista enlazada), superpuesto
  // sobre el catálogo público. Con sesión, un marcador hasta que llega.
  const preciosCuenta = usePreciosCuenta(productos.map((p) => p.id));
  const productosCuenta = useMemo(
    () => productos.map((p) => aplicarEstadoPrecio(p, preciosCuenta.get(p.id))),
    [productos, preciosCuenta],
  );

  // Mejor opción de cuotas sin interés por producto (viene armada del servidor, con flag).
  const cuotasPorProducto = useMemo(() => {
    const m = new Map<string, OpcionCuotas>();
    for (const p of productosCuenta) {
      const mejor = mejorCuotaProducto(p.cuotasSinInteres);
      if (mejor) m.set(p.id, mejor);
    }
    return m;
  }, [productosCuenta]);

  const conFiltros = hayFiltros(estado);

  // Con los filtros de todo el catálogo (búsqueda sin resultados), filtrar
  // sin sacar la búsqueda volvería a dar 0: el panel la quita al tocarlo.
  const irFiltros = filtrosSinBusqueda
    ? (cambios: Partial<EstadoCatalogo>) => ir({ ...cambios, query: undefined })
    : ir;
  const estadoFiltros = filtrosSinBusqueda ? { ...estadoVisible, query: undefined } : estadoVisible;

  const consultaVacia = interpretacionVigente(estado) ?? estado.query;

  // Con el filtro de local activo (también el recordado por cookie), el sin resultados lo dice
  // y ofrece quitarlo: `ir` también olvida la cookie, igual que el chip y el panel.
  const sinLocal = sinResultadosPorLocal(estado, facetas.locales ?? [], consultaVacia);
  const quitarLocal = () => ir({ retiroEn: undefined });
  const verSinStock = () => ir({ soloStock: false });

  // Señales de la invitación proactiva del asesor (src/lib/iniciativa/): cada
  // búsqueda distinta y si terminó sin resultados (después del rescate de la
  // búsqueda inteligente, que ya corrió en el servidor). Sin chat no hace nada;
  // el chat se carga aparte, así que se vuelve a anotar cuando aparece (la
  // misma búsqueda no cuenta dos veces).
  const { disponible: chatDisponible } = useChatIa();
  // Con la búsqueda inteligente, en el sin resultados (CatalogoSinResultados) no se
  // invita al asesor: el teaser tampoco aparece ahí.
  const sinResultados = productos.length === 0;
  const conInvitacionEnLinea = sinResultados && !!busquedaIa;
  useEffect(() => {
    if (consultaVacia && chatDisponible) anotarBusqueda(consultaVacia, sinResultados, conInvitacionEnLinea);
  }, [consultaVacia, sinResultados, conInvitacionEnLinea, chatDisponible]);

  // Telemetría (búsqueda v2): una búsqueda entendida recién llegada de `/buscar`.
  const conPlan = !!busquedaIa && estado.ia === IA_PLAN && estado.pagina === 1 && !!estado.query;
  useEffect(() => {
    if (conPlan && estado.query) enviarBusquedaEnviada(estado.query, total, etapa);
  }, [conPlan, estado.query, total, etapa]);

  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8">
      {/* Encabezado a todo el ancho, por encima de las dos columnas. Vista y
          orden van en la línea del título —y en mobile, con ellos, el botón
          que abre la hoja— para que abajo el panel y la grilla arranquen a la
          misma altura. */}
      <CatalogoEncabezado
        estado={estado}
        acciones={
          <div className="flex items-center gap-3 max-lg:w-full max-lg:justify-between">
            <div className="lg:hidden">
              <CatalogoFiltrosSheet
                facetas={facetas}
                estado={estadoFiltros}
                navegar={navegar}
                conFacetasPorTipo={conFacetasPorTipo}
                navegando={navegando || desfasado}
              />
            </div>
            <CatalogoControles estado={estadoVisible} ir={ir} />
          </div>
        }
      />

      {/* Los filtros puestos, debajo del encabezado: en mobile son lo único que
          dice qué está aplicado; en desktop destacan el local, que en el panel
          queda al pie. */}
      <CatalogoChips
        estado={estadoVisible}
        rango={facetas.precio}
        locales={facetas.locales}
        ir={ir}
      />

      {localRecordado && estado.retiroEn ? (
        <CatalogoAvisoLocal local={localRecordado} quitar={quitarLocal} />
      ) : null}

      <div className="mt-8 flex gap-6">
        {/*
          Filtros sticky en desktop: quedan a la vista mientras se recorre la
          grilla. `self-start` evita que el aside se estire al alto de la
          grilla (sin eso no hay nada que "pegar").
          - `top-20` (80px): al bajar, el header completo se va y en su lugar
            aparece la barra compacta fija del SiteHeader (`compactOnScroll`),
            de 56px (`h-14` en el DS). El panel se pega debajo de ella con
            24px de aire; con el `top-6` de antes quedaba tapado. Si la barra
            cambia de alto en el DS, este valor tiene que acompañarla (el DS
            no expone su alto como token).
          - Si el panel es más alto que la pantalla (marcas expandidas),
            scrollea adentro: el alto máximo es la pantalla menos el `top-20`,
            para que el borde inferior del panel (y su difuminado) quede
            dentro de la pantalla.
          - Sin barra de scroll: un difuminado de 48px arriba y/o abajo, sólo
            del lado donde haya más contenido por ver; el `pb-12` deja el último filtro por encima de él.
        */}
        <aside
          ref={panelRef}
          onScroll={medirPanel}
          className={`sticky top-20 hidden max-h-[calc(100dvh-5rem)] w-64 shrink-0 self-start overflow-y-auto overscroll-contain pb-12 [scrollbar-width:none] lg:block ${
            hayMasArriba && hayMasAbajo
              ? "[mask-image:linear-gradient(to_bottom,transparent,black_48px,black_calc(100%-48px),transparent)]"
              : hayMasAbajo
                ? "[mask-image:linear-gradient(to_bottom,black_calc(100%-48px),transparent)]"
                : hayMasArriba
                  ? "[mask-image:linear-gradient(to_bottom,transparent,black_48px)]"
                  : ""
          }`}
        >
          <CatalogoFiltros key={entrada} facetas={facetas} estado={estadoFiltros} ir={irFiltros} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {productos.length === 0 && busquedaIa && consultaVacia ? (
            <CatalogoSinResultados
              consulta={consultaVacia}
              alternativas={busquedaIa.alternativas}
              sinFiltros={conFiltros ? () => ir(limpiarFiltros()) : undefined}
              relacionadosHref={busquedaIa.relacionadosHref}
              verTodos={() => ir({ ...limpiarFiltros(), query: undefined, ia: undefined })}
              local={sinLocal ? { ...sinLocal, quitar: quitarLocal } : undefined}
              sinStock={sinStock > 0 ? { total: sinStock, ver: verSinStock } : undefined}
            />
          ) : productos.length === 0 ? (
            // Sin culpar al visitante ("revise la ortografía"): se dice qué
            // pasó y se ofrece por dónde seguir.
            estado.query ? (
              <EmptyState
                title={sinLocal?.titulo ?? `No hay resultados para "${estado.query}"`}
                description={
                  sinLocal?.descripcion ??
                  (sinStock > 0
                    ? TEXTOS_SIN_RESULTADOS.sinStock(sinStock)
                    : "Puede buscar con otras palabras o elegir una categoría de la lista.")
                }
                action={
                  sinLocal ? (
                    <Button variant="primary" onClick={quitarLocal}>
                      {sinLocal.accion}
                    </Button>
                  ) : sinStock > 0 ? (
                    <Button variant="primary" onClick={verSinStock}>
                      {TEXTOS_SIN_RESULTADOS.verSinStock}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => ir({ ...limpiarFiltros(), query: undefined })}>
                      Ver todos los productos
                    </Button>
                  )
                }
              />
            ) : (
              <EmptyState
                title={sinLocal?.titulo ?? "No hay productos con estos filtros"}
                description={sinLocal?.descripcion ?? "Quite alguno para ver más opciones."}
                action={
                  sinLocal ? (
                    <Button variant="primary" onClick={quitarLocal}>
                      {sinLocal.accion}
                    </Button>
                  ) : conFiltros ? (
                    <Button variant="secondary" onClick={() => ir(limpiarFiltros())}>
                      Limpiar filtros
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <CatalogoProductos
              productos={productosCuenta}
              vista={estadoVisible.vista}
              navegando={navegando || desfasado}
              cuotasPorProducto={cuotasPorProducto}
              alElegir={
                busquedaIa && estado.query
                  ? (i) => enviarClickResultado(estado.pagina, i, estado.ia === IA_PLAN)
                  : undefined
              }
            />
          )}

          {/* Cada página es una URL real: se comparte, se abre en otra pestaña y se indexa. */}
          {paginas > 1 && (
            <div className="flex justify-center">
              <Pagination
                page={estado.pagina}
                totalPages={paginas}
                hrefFor={(n) => hrefCon(estado, { pagina: n })}
                renderLink={linkNext}
                labels={{ ariaLabel: "Paginación del catálogo" }}
              />
            </div>
          )}

          {/* Sólo para lectores de pantalla: el cambio de página no mueve el foco. */}
          <p className="sr-only" role="status">
            {anuncioResultados(productos.length, total, estado.pagina, paginas)}
          </p>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { cn } from "@myd-org/ui";
import type { ProductImage, VideoProducto } from "@/data/products";
import { LightbulbIcon } from "@/components/catalogo/iconos";
import { VisorFotos, Chevron, etiquetaFlecha } from "@/components/VisorFotos";
import { VideoFacade, IconoPlay } from "@/components/producto/VideoFacade";
import { armarItems, claveItem, debeMontarIframe } from "@/components/galeria-items";

/**
 * Galería de la ficha con las fotos del overlay del CRM (portada = [0]), ya
 * filtradas a los hosts de medios permitidos. Sin fotos, el placeholder de
 * siempre. Con más de una, miniaturas para elegir cuál se ve en grande.
 *
 * La foto grande es una pista horizontal con scroll-snap: en el celular se
 * pasa de foto deslizando el dedo (con la inercia y el rebote nativos, sin
 * JS de gestos) y en desktop con el trackpad. Las miniaturas desplazan la
 * pista con scroll suave, así el cambio siempre es el mismo deslizamiento
 * lateral que el del dedo (y no un corte). Con reduced motion el salto es
 * instantáneo. La foto activa sale de la posición del scroll: una sola
 * fuente de verdad para el dedo, el trackpad, las flechas y las miniaturas.
 *
 * En el celular la foto es 4:3 (así el precio entra en la primera pantalla) y
 * las miniaturas van abajo; desde lg la foto es cuadrada con un tope de alto
 * (36rem, o menos en pantallas bajas: no puede taparse la ficha) y las miniaturas
 * forman una columna a la izquierda. `acciones` (compartir, favorito) flota
 * arriba a la derecha de la foto.
 *
 * En la compu (puntero fino: mouse o trackpad) hay flechas de anterior/siguiente a los costados
 * de la foto grande; en el celular no, se desliza con el dedo.
 *
 * Tocar la foto grande la abre a pantalla completa (`VisorFotos`). Un
 * deslizamiento no dispara el clic, así que pasar de foto no abre el visor.
 *
 * Los videos de YouTube van después de las fotos, en la pista y en las miniaturas (poster con
 * play). Hasta tocar play el slide es sólo el poster: ni iframe ni JS de YouTube. Tocarlo lo
 * reproduce ahí mismo; al pasar a otro slide el iframe se desmonta (deja de sonar). El visor a
 * pantalla completa se abre desde las fotos y también recorre los videos. Un producto con videos
 * y sin fotos muestra la pista con los videos, sin placeholder.
 */
export function GaleriaProducto({
  fotos,
  videos,
  nombre,
  acciones,
}: {
  fotos?: ProductImage[];
  videos?: VideoProducto[];
  nombre: string;
  acciones?: ReactNode;
}) {
  const [activa, setActiva] = useState(0);
  const [visor, setVisor] = useState<{
    inicial: number;
    reproducir: boolean;
  } | null>(null);
  // Video que suena en el carrusel (sólo mientras su slide es el activo).
  const [reproduciendoId, setReproduciendoId] = useState<string | null>(null);
  const pistaRef = useRef<HTMLDivElement>(null);

  // Al salir de la ficha Next la oculta (<Activity>) sin desmontarla: al volver tiene que verse el
  // poster con el play, no un video a mitad de camino ni el visor abierto. (El audio lo corta
  // VideoFacade en el momento de ocultarse.)
  useLayoutEffect(
    () => () => {
      setReproduciendoId(null);
      setVisor(null);
    },
    [],
  );

  const lista = useMemo(() => armarItems(fotos, videos), [fotos, videos]);
  const varias = lista.length > 1;
  const nFotos = lista.filter((x) => x.tipo === "foto").length;
  const nVideos = lista.length - nFotos;

  function alDesplazar() {
    const pista = pistaRef.current;
    if (!pista || pista.clientWidth === 0) return;
    const i = Math.max(0, Math.min(Math.round(pista.scrollLeft / pista.clientWidth), lista.length - 1));
    if (i !== activa) setReproduciendoId(null);
    setActiva(i);
  }

  function irA(i: number) {
    const pista = pistaRef.current;
    if (!pista) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pista.scrollTo({
      left: i * pista.clientWidth,
      behavior: quieto ? "instant" : "smooth",
    });
  }

  function cerrarVisor(i: number) {
    setVisor(null);
    setReproduciendoId(null);
    // La galería queda en el slide en el que se cerró el visor, sin animar.
    const pista = pistaRef.current;
    if (pista) pista.scrollLeft = i * pista.clientWidth;
    setActiva(i);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row-reverse lg:gap-4">
      <div className="relative aspect-[4/3] min-w-0 flex-1 overflow-hidden rounded-[24px] border border-border bg-surface lg:aspect-square lg:max-h-[min(36rem,calc(100dvh-14rem))]">
        {lista.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <LightbulbIcon className="h-28 w-28 text-muted/20 lg:h-44 lg:w-44" />
          </div>
        ) : (
          <div
            ref={pistaRef}
            onScroll={varias ? alDesplazar : undefined}
            // Con varias fotos la pista es foco de teclado: las flechas la
            // desplazan (nativo) y el snap la deja en una foto entera.
            tabIndex={varias ? 0 : undefined}
            role={varias ? "region" : undefined}
            aria-label={varias ? "Fotos del producto, deslice para ver más" : undefined}
            // overscroll-x-contain: al llegar a la última foto, el gesto no
            // sigue de largo como "atrás" del navegador.
            className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]"
          >
            {lista.map((f, i) =>
              f.tipo === "video" ? (
                <div
                  key={claveItem(f)}
                  className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center p-4"
                >
                  <VideoFacade
                    video={f}
                    reproduciendo={debeMontarIframe(f, i, activa, reproduciendoId)}
                    onReproducir={() => setReproduciendoId(f.id)}
                    titulo={nombre}
                  />
                </div>
              ) : (
                <button
                  key={claveItem(f)}
                  type="button"
                  onClick={() => setVisor({ inicial: i, reproducir: false })}
                  aria-label={`Ampliar foto ${i + 1} de ${nFotos}`}
                  className="relative block h-full w-full shrink-0 cursor-zoom-in snap-center snap-always focus-visible:outline-none"
                >
                  <Image
                    src={f.url}
                    alt={f.alt || nombre}
                    fill
                    // La galería ocupa ~la mitad del contenido desde lg; debajo, todo el ancho.
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-contain p-6"
                    // La portada es el elemento más grande de la ficha (LCP).
                    preload={i === 0}
                    // Las vecinas de la activa se cargan ya: al deslizar tienen
                    // que estar listas. El resto, cuando haga falta. (La portada
                    // no lleva `loading`: con `preload` no se combina.)
                    loading={i === 0 ? undefined : Math.abs(i - activa) <= 1 ? "eager" : "lazy"}
                  />
                </button>
              ),
            )}
          </div>
        )}
        {varias && (
          <>
            {activa > 0 && <FlechaGaleria hacia="prev" item={lista[activa - 1]} onClick={() => irA(activa - 1)} />}
            {activa < lista.length - 1 && (
              <FlechaGaleria hacia="next" item={lista[activa + 1]} onClick={() => irA(activa + 1)} />
            )}
          </>
        )}
        {acciones && <div className="absolute right-3 top-3 flex gap-2">{acciones}</div>}
      </div>

      {varias && (
        <ul
          className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:w-16 lg:shrink-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0"
          aria-label={lista.some((x) => x.tipo === "video") ? "Fotos y videos del producto" : "Fotos del producto"}
        >
          {lista.map((f, i) => (
            <li key={claveItem(f)} className="shrink-0">
              <button
                type="button"
                onClick={() => irA(i)}
                aria-label={
                  f.tipo === "video" ? `Ver video ${i - nFotos + 1} de ${nVideos}` : `Ver foto ${i + 1} de ${nFotos}`
                }
                aria-pressed={i === activa}
                className={cn(
                  "relative block h-16 w-16 overflow-hidden rounded-xl border bg-surface transition-[border-color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] motion-reduce:active:scale-100",
                  i === activa ? "border-primary" : "border-border hover:border-muted",
                )}
              >
                {f.tipo === "video" ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- poster de i.ytimg.com: <img> común */}
                    <img
                      src={f.poster}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        if (e.currentTarget.src !== f.posterRespaldo) e.currentTarget.src = f.posterRespaldo;
                      }}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white">
                        <IconoPlay className="ml-px h-3 w-3" />
                      </span>
                    </span>
                  </>
                ) : (
                  <Image src={f.url} alt="" fill sizes="64px" className="object-contain p-1" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {visor && (
        <VisorFotos
          items={lista}
          nombre={nombre}
          inicial={visor.inicial}
          reproducirInicial={visor.reproducir}
          onCerrar={cerrarVisor}
        />
      )}
    </div>
  );
}

/** Flecha de la foto grande. Sólo con puntero fino (compu): en el celular se desliza con el dedo. */
export function FlechaGaleria({
  hacia,
  item,
  onClick,
}: {
  hacia: "prev" | "next";
  item: ReturnType<typeof armarItems>[number];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiquetaFlecha(hacia, item)}
      className={cn(
        "absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text shadow-2 transition-[scale] duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] motion-reduce:active:scale-100 pointer-fine:flex",
        hacia === "prev" ? "left-3" : "right-3",
      )}
    >
      <Chevron hacia={hacia} />
    </button>
  );
}

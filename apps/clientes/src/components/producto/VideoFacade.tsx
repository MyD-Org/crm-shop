"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { VideoProducto } from "@/data/products";

/** Proporción mientras no se conoce la del poster (la de un video horizontal). */
const ASPECTO_INICIAL = 16 / 9;

/** URL del reproductor: sin cookies, con autoplay, sin relacionados y en línea en iOS. */
export const urlReproductor = (embed: string) => `${embed}?autoplay=1&rel=0&playsinline=1`;

/**
 * Video de YouTube de la ficha, controlado desde afuera. Mientras `reproduciendo` es false sólo
 * hay una miniatura (`<img>` común del poster) y un botón de play: ni iframe ni JS de YouTube.
 * Con `reproduciendo` se monta el reproductor (youtube-nocookie, autoplay, sin relacionados)
 * encima del poster.
 *
 * El poster es la miniatura en la proporción ORIGINAL del video (`oar2`): vertical para un Short,
 * horizontal para el resto. Su tamaño natural da la proporción de la caja, que entra entera en el
 * slide (`container-type: size` + `cqw`/`cqh`), así un Short se ve vertical y sin franjas. El
 * poster queda montado debajo del iframe para no perder la proporción al reproducir.
 *
 * Lo usan el carrusel de la ficha (reproduce en el lugar) y el visor a pantalla completa; los dos
 * montan el iframe sólo en el slide activo.
 *
 * Al salir de la ficha, Next no la desmonta: la oculta con `<Activity>` (cacheComponents) y el
 * iframe oculto seguiría sonando. El cleanup de layout corre al ocultarse, antes de que React
 * procese el estado del padre, y corta el audio en el acto vaciando el `src`.
 */
export function VideoFacade({
  video,
  reproduciendo,
  onReproducir,
  titulo,
}: {
  video: Pick<VideoProducto, "id" | "embed" | "poster" | "posterRespaldo">;
  reproduciendo: boolean;
  onReproducir: () => void;
  titulo: string;
}) {
  const [aspecto, setAspecto] = useState(ASPECTO_INICIAL);
  const [poster, setPoster] = useState(video.poster);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = urlReproductor(video.embed);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!reproduciendo || !iframe) return;
    // StrictMode (dev) monta, limpia y vuelve a montar: se repone el src que vació el cleanup.
    if (iframe.getAttribute("src") !== src) iframe.setAttribute("src", src);
    return () => iframe.setAttribute("src", "about:blank");
  }, [reproduciendo, src]);

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
      <div
        className="relative overflow-hidden rounded-xl bg-black"
        style={{ aspectRatio: aspecto, width: `min(100cqw, calc(100cqh * ${aspecto}))` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- poster de i.ytimg.com: <img> común, sin tocar remotePatterns ni pasar por el optimizador */}
        <img
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w > 0 && h > 0) setAspecto(w / h);
          }}
          // `oar2` puede faltar en algún video: se cae a la miniatura clásica.
          onError={() => {
            if (poster !== video.posterRespaldo) setPoster(video.posterRespaldo);
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {reproduciendo ? (
          <iframe
            ref={iframeRef}
            src={src}
            title={`Video de ${titulo}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            loading="eager"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={onReproducir}
            aria-label="Reproducir video"
            className="group absolute inset-0 flex cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-white transition-transform duration-150 ease-out group-hover:scale-105 group-active:scale-95">
              <IconoPlay className="ml-1 h-7 w-7" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Triángulo de play, decorativo. */
export function IconoPlay({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

"use client";

import { useState } from "react";
import type { VideoProducto } from "@/data/products";

/** Proporción mientras no se conoce la del poster (la de un video horizontal). */
const ASPECTO_INICIAL = 16 / 9;

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
            src={`${video.embed}?autoplay=1&rel=0&playsinline=1`}
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

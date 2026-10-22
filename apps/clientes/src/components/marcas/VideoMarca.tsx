"use client";

import { useState } from "react";
import { videoEmbebible } from "@/lib/marcas/video";

/**
 * Video de YouTube o Vimeo en una página de marca. Hasta que se toca "Reproducir" sólo hay una
 * miniatura (YouTube) o un fondo: el reproductor de terceros (y sus cookies y scripts) se carga
 * recién al elegirlo. YouTube va por su dominio sin cookies.
 */
export function VideoMarca({ url, titulo }: { url: string; titulo: string }) {
  const [activo, setActivo] = useState(false);
  const video = videoEmbebible(url);
  if (!video) return null;
  if (activo) {
    return (
      <iframe
        src={`${video.embed}?autoplay=1`}
        title={titulo}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setActivo(true)}
      aria-label={`Reproducir: ${titulo}`}
      className="group absolute inset-0 flex items-center justify-center bg-elevated bg-cover bg-center"
      style={video.proveedor === "youtube" ? { backgroundImage: `url(${video.poster})` } : undefined}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-white transition-transform group-hover:scale-105">
        <svg aria-hidden viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </button>
  );
}

import type { VideoProducto } from "@/data/products";

/**
 * Video de YouTube de la ficha, controlado desde afuera. Mientras `reproduciendo` es false sólo
 * hay una miniatura (`<img>` común del poster) y un botón de play: ni iframe ni JS de YouTube.
 * Con `reproduciendo` se monta el reproductor (youtube-nocookie, autoplay, sin relacionados),
 * siempre en una caja 16:9 para que el slide que la contiene deje márgenes que sí desplazan.
 *
 * El carrusel de la ficha nunca lo pone en reproducción: el botón abre el visor (`onReproducir`).
 * Sólo el visor lo pasa a `reproduciendo`, y sólo en el slide activo.
 */
export function VideoFacade({
  video,
  reproduciendo,
  onReproducir,
  titulo,
}: {
  video: Pick<VideoProducto, "id" | "embed" | "poster">;
  reproduciendo: boolean;
  onReproducir: () => void;
  titulo: string;
}) {
  if (reproduciendo) {
    return (
      <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl bg-black">
        <iframe
          src={`${video.embed}?autoplay=1&rel=0&playsinline=1`}
          title={`Video de ${titulo}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          loading="eager"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onReproducir}
      aria-label="Reproducir video"
      className="group relative block aspect-video w-full max-w-4xl cursor-pointer overflow-hidden rounded-xl bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- poster de i.ytimg.com: <img> común, sin tocar remotePatterns ni pasar por el optimizador */}
      <img
        src={video.poster}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-white transition-transform duration-150 ease-out group-hover:scale-105 group-active:scale-95">
          <IconoPlay className="ml-1 h-7 w-7" />
        </span>
      </span>
    </button>
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

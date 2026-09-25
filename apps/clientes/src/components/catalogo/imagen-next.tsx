"use client";

import Image from "next/image";
import type { RenderImage } from "@myd-org/ui";
import { esImagenOptimizable } from "@/lib/imagenes";

/**
 * Hosts remotos que acepta el optimizador: los mismos de `remotePatterns`
 * (next.config.ts los inlinea en build desde SHOP_MEDIA_HOSTS). Son nombres
 * de host, no secretos; igual nunca van literales en el repo.
 */
const HOSTS = (process.env.HOSTS_IMAGENES ?? "").split(",").filter(Boolean);

/**
 * Enchufe de `next/image` para los componentes del DS que aceptan
 * `renderImage` (Hero, PromoBanner, RoomTiles, Marquee). Mismo patrón que
 * `linkNext`: módulo de cliente, así un Server Component lo pasa como
 * referencia. El DS decide clases, `sizes`, `fit` y prioridad; acá sólo se
 * cambia el `<img>` por el de Next (srcset + WebP + calidad 75 de next.config).
 *
 * - `cover`: `fill` (el `<img>` sigue siendo hijo directo de la sección: el CSS
 *   del hero interactivo apunta a `.root > section > img`). Con `priority`
 *   (sólo el hero) se precarga desde el `<head>` con prioridad alta; el resto
 *   queda lazy.
 * - `logo`: ancho y alto nominales para el srcset; el tamaño real lo manda la
 *   clase del DS (`h-7 w-auto max-w-[150px]`).
 * - Si la URL no es optimizable (host fuera de SHOP_MEDIA_HOSTS, data:, etc.),
 *   `<img>` común: con `next/image` quedaría rota (400).
 *
 * `sizes` y `fit` nunca llegan al DOM como atributos sueltos; los `data-*` sí.
 */
export const imagenNext: RenderImage = ({ src, alt, className, sizes, fit, priority, ...data }) => {
  if (!esImagenOptimizable(src, HOSTS)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- fuera de remotePatterns: next/image daría 400
      <img
        src={src}
        alt={alt}
        className={className}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        {...data}
      />
    );
  }
  if (fit === "logo") {
    return <Image src={src} alt={alt} className={className} width={300} height={56} sizes={sizes} draggable={false} {...data} />;
  }
  return (
    <Image
      src={src}
      alt={alt}
      className={className}
      fill
      sizes={sizes}
      {...(priority ? { preload: true, fetchPriority: "high" as const } : {})}
      {...data}
    />
  );
};

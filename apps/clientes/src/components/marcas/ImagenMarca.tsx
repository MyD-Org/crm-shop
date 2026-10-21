"use client";

import type { RenderImageProps } from "@myd-org/ui";
import { imagenNext } from "@/components/catalogo/imagen-next";

/**
 * `imagenNext` como componente: los bloques de marca son Server Components y no
 * pueden llamar una función de un módulo de cliente; sí pueden renderizar esto.
 */
export function ImagenMarca(props: RenderImageProps) {
  return imagenNext(props);
}

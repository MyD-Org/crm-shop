"use client";

/**
 * Límite de cliente para el `Carousel` del DS, que usa hooks: `HomeClient` es
 * un server component y no puede importarlo directo. El repo del DS no marca
 * `"use client"` (lo hace el consumidor), así que el borde vive acá.
 */
export { Carousel as ProductosCarrusel } from "@myd-org/ui";

"use client";

import type { RenderLink } from "@myd-org/ui";

/** Enlace a otro sitio (por ejemplo un mapa): se abre en una pestaña nueva, sin pasar el `opener`. */
export const linkExterno: RenderLink = (props) => <a {...props} target="_blank" rel="noopener noreferrer" />;

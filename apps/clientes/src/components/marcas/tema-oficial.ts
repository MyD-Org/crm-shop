import type { CSSProperties } from "react";
import { temaDe, type PaginaMarca } from "@/lib/marcas/pagina-marca";

/**
 * Atributos del contenedor con el tema de la tienda oficial (`globals.css`): oscuro o claro según
 * la página, y su acento propio si eligió uno (si no, el del tema, que pone el CSS).
 */
export function propsTemaOficial(p: Pick<PaginaMarca, "tema" | "acento">): {
  "data-tema-marca": "oficial";
  "data-tono": "oscuro" | "claro";
  style?: CSSProperties;
} {
  return {
    "data-tema-marca": "oficial",
    "data-tono": temaDe(p),
    ...(p.acento ? { style: { "--acento-marca": p.acento } as CSSProperties } : {}),
  };
}

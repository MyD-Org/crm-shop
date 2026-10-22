import type { EstiloFotos } from "@/lib/marcas/pagina-marca";

/**
 * Atributo que activa el estilo "estudio" en las cards de adentro (`[data-estudio]` en
 * `globals.css`): fondo con degradé y sombra de contacto. Normal: nada.
 */
export function atributoEstudio(estilo: EstiloFotos | undefined): { "data-estudio"?: "oscuro" | "claro" } {
  if (estilo === "estudio-oscuro") return { "data-estudio": "oscuro" };
  if (estilo === "estudio-claro") return { "data-estudio": "claro" };
  return {};
}

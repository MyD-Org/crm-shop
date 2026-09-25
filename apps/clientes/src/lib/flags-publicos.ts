/**
 * Flags que cambian lo que ve CUALQUIER visitante (no dependen de quién es):
 * `catalogo-solo-visibles` y `cuotas`. Se evalúan por request, afuera de los
 * scopes cacheados, y viajan como argumento a las funciones de
 * src/lib/catalogo-publico.ts: así el valor del flag es parte de la clave de
 * la caché (prenderlo o apagarlo se ve en la vista siguiente, sin esperar a
 * que venza nada) y los overrides del Flags Explorer siguen valiendo.
 *
 * Nunca llamar esto dentro de `'use cache'`: la evaluación de un flag lee el
 * request. Deduplicado por request con `cache` de React.
 */
import { cache } from "react";
import { catalogoSoloVisibles } from "./catalogo-flag";
import { cuotasHabilitadas } from "./cuotas-flag";

export interface FlagsPublicos {
  /** `catalogo-solo-visibles`: los listados públicos sólo con lo curado en el CRM. */
  soloVisibles: boolean;
  /** `cuotas`: se exhibe la oferta de cuotas. */
  cuotas: boolean;
}

export const flagsPublicos = cache(async (): Promise<FlagsPublicos> => {
  const [soloVisibles, cuotas] = await Promise.all([catalogoSoloVisibles(), cuotasHabilitadas()]);
  return { soloVisibles, cuotas };
});

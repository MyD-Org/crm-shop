/**
 * Flags que cambian lo que ve CUALQUIER visitante (no dependen de quién es):
 * `catalogo-solo-visibles` y `cuotas-cobro`. Se evalúan por request, afuera de los
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
import { mediosOfrecibles } from "./medios-pago-datos";
import { SIN_MEDIOS_PRECIO, seleccionarMediosPrecio, type MediosPrecio } from "./medios-precio";

export interface FlagsPublicos {
  /** `catalogo-solo-visibles`: los listados públicos sólo con lo curado en el CRM. */
  soloVisibles: boolean;
  /** `cuotas-cobro`: se exhiben las cuotas sin interés y se cobra en cuotas. */
  cuotas: boolean;
  /**
   * "$X con <Medio>": el medio destacado de las cards y los de la ficha. Vacío si los
   * medios no se pueden leer (degrada sin romper).
   */
  mediosPrecio: MediosPrecio;
}

const mensaje = (err: unknown) => (err instanceof Error ? err.message : err);

async function leerMediosPrecio(cuotasEncendido: boolean): Promise<MediosPrecio> {
  try {
    return seleccionarMediosPrecio(await mediosOfrecibles(), false, cuotasEncendido);
  } catch (err) {
    console.warn("[flags-publicos] medios con precio no disponibles:", mensaje(err));
    return SIN_MEDIOS_PRECIO;
  }
}

export const flagsPublicos = cache(async (): Promise<FlagsPublicos> => {
  const [soloVisibles, cuotas] = await Promise.all([catalogoSoloVisibles(), cuotasHabilitadas()]);
  const mediosPrecio = await leerMediosPrecio(cuotas);
  return { soloVisibles, cuotas, mediosPrecio };
});

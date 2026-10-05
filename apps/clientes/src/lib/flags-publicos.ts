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
import { mediosOfrecibles } from "./medios-pago-datos";
import { SIN_MEDIOS_PRECIO, seleccionarMediosPrecio, type MediosPrecio } from "./medios-precio";
import { precioEspecialCuenta } from "./precio-especial-flag";

export interface FlagsPublicos {
  /** `catalogo-solo-visibles`: los listados públicos sólo con lo curado en el CRM. */
  soloVisibles: boolean;
  /** `cuotas`: se exhibe la oferta de cuotas. */
  cuotas: boolean;
  /**
   * "$X con <Medio>": el medio destacado de las cards y los de la ficha. Vacío con el flag
   * `precio-especial-cuenta` encendido o si los medios no se pueden leer (degrada sin romper).
   */
  mediosPrecio: MediosPrecio;
}

const mensaje = (err: unknown) => (err instanceof Error ? err.message : err);

async function leerMediosPrecio(): Promise<MediosPrecio> {
  try {
    if (await precioEspecialCuenta()) return SIN_MEDIOS_PRECIO;
    return seleccionarMediosPrecio(await mediosOfrecibles(), false);
  } catch (err) {
    console.warn("[flags-publicos] medios con precio no disponibles:", mensaje(err));
    return SIN_MEDIOS_PRECIO;
  }
}

export const flagsPublicos = cache(async (): Promise<FlagsPublicos> => {
  const [soloVisibles, cuotas, mediosPrecio] = await Promise.all([
    catalogoSoloVisibles(),
    cuotasHabilitadas(),
    leerMediosPrecio(),
  ]);
  return { soloVisibles, cuotas, mediosPrecio };
});

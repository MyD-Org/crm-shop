/**
 * Flag del motor de búsqueda único (`busqueda-v2/motor.ts`): qué política corre cada superficie.
 *
 * Apagado (default): política `legado`, la búsqueda de siempre (plan o exacta y, si no trae nada,
 * el reintento tolerante), sin cambios de conducta.
 * Prendido: política `cascada` en las superficies que la tengan habilitada (hoy catálogo y
 * autocompletar; ver `SUPERFICIES_EN_CASCADA` en `busqueda-v2/motor-servidor.ts`): etapa de
 * código, plan, exacta y tolerante conservando el plan, con presupuesto de tiempo por etapa.
 *
 * `busqueda-ia` sigue siendo el interruptor general: apagado, ninguna política usa plan. Se lee
 * sólo en el server, nunca dentro de `use cache`. Vive en Vercel Flags (key `busqueda-motor-unico`,
 * ver src/flags.ts): se cambia sin redeploy. Si no se puede evaluar, se asume apagado (legado).
 */
import { busquedaMotorUnicoFlag } from "@/flags";

export async function busquedaMotorUnico(): Promise<boolean> {
  try {
    return (await busquedaMotorUnicoFlag()) === true;
  } catch {
    return false;
  }
}

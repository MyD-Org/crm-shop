/**
 * Flag `aviso-reingreso` (change `aviso-reingreso`). Se lee sólo en el server, por request, y NUNCA
 * dentro de `use cache`: la ficha lo resuelve en el server component y baja el resultado como prop.
 *
 * Apagado (default): la ficha de un producto agotado muestra sólo "Sin stock", como siempre; el
 * cron no envía. La ruta de baja del mail NO mira este flag (los avisos ya existentes siguen
 * pudiendo darse de baja).
 *
 * Vive en Vercel Flags (key `aviso-reingreso`, ver src/flags.ts): se cambia sin redeploy. Si no se
 * puede evaluar, se asume apagado (fail-closed).
 */
import { avisoReingresoFlag } from "@/flags";

export async function avisoReingresoActivo(): Promise<boolean> {
  try {
    return (await avisoReingresoFlag()) === true;
  } catch {
    return false;
  }
}

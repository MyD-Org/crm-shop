/**
 * Flag de la búsqueda por medidas ("termica 2x20", "lampara 9w e27", "bipolar 20a"). Se lee sólo en
 * el server, por request, y nunca dentro de `use cache`.
 *
 * Apagado (default): la búsqueda queda idéntica a la de siempre; no se emite ningún id de medida
 * (`aplicarMedidas` no se llama).
 * Prendido: el plan de cada búsqueda suma las medidas que la consulta pidió (filtros "por no
 * contradicción" para las claves discretas con buena cobertura; el resto sólo ordena). Los ids de
 * medida que llegan por URL (`?atr=corriente_a:20`) valen siempre: el flag gobierna la EMISIÓN
 * desde la consulta, no la lectura.
 *
 * Vive en Vercel Flags (key `busqueda-medidas`, ver src/flags.ts): se cambia sin redeploy. Si no
 * se puede evaluar, se asume apagado.
 */
import { busquedaMedidasFlag } from "@/flags";

export async function busquedaMedidasHabilitada(): Promise<boolean> {
  try {
    return (await busquedaMedidasFlag()) === true;
  } catch {
    return false;
  }
}

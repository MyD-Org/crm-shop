/**
 * Lista de precios que corresponde al medio de pago elegido. Lógica PURA, sin base ni flags.
 *
 * La lista se resuelve SIEMPRE en el servidor desde el `slug` del medio (nunca desde un id o un
 * precio que mande el navegador): sólo cuenta un medio activo que aplica a la modalidad de entrega.
 * Sin lista, slug inexistente/inactivo/no aplicable, o `a_coordinar` ⇒ `undefined` = lista por
 * defecto. Que el precio de esa lista rija o no lo decide `precioDeLista` (sólo si es > 0 y menor
 * que el general), no este módulo.
 */
import type { EntregaTipo } from "./envio";
import { idListaDeCuotas } from "./cuotas-sin-interes";
import { mediosParaModalidad, type MedioPago, type OpcionesMedios } from "./medios-pago";

export function idListaDelMedio(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  slug: string | null | undefined,
  opts?: OpcionesMedios,
  /**
   * Cuotas sin interés elegidas (rebanada D). N >= 2 toma la lista de la condición (medio, N); 1 o
   * ausente, la del pago único. Una cantidad sin condición no inventa lista (rige la referencia):
   * quien acepta la cantidad la valida antes con `cuotasElegidas`.
   */
  cuotas?: number | null,
): string | undefined {
  if (!slug) return undefined;
  const medio = mediosParaModalidad(medios, entrega, opts).find((m) => m.slug === slug);
  if (!medio) return undefined;
  if (typeof cuotas === "number" && cuotas >= 2) return idListaDeCuotas(medio.condicionesCuotas, cuotas);
  return medio.idListaPrecios || undefined;
}

/**
 * Qué mandar a la cotización del checkout para el medio elegido. `listaKey` es lo que dispara (o no)
 * un refetch: la lista del medio ('' si no tiene), NO el slug, así medios sin lista o con la misma
 * lista comparten cotización y no se pega de más al límite de 20 por minuto. `pagoMetodo` es un slug
 * CANÓNICO de esa lista (el primer medio aplicable que la comparte), de modo que cambiar entre dos
 * medios con la misma lista no cambia el payload. Sin lista no se manda slug.
 */
export function pagoParaCotizar(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  medioSel: Pick<MedioPago, "idListaPrecios"> | null,
  opts?: OpcionesMedios,
): { listaKey: string; pagoMetodo: string | undefined } {
  const listaKey = medioSel?.idListaPrecios || "";
  if (!listaKey) return { listaKey: "", pagoMetodo: undefined };
  const canonico = mediosParaModalidad(medios, entrega, opts).find((m) => m.idListaPrecios === listaKey);
  return { listaKey, pagoMetodo: canonico?.slug };
}

/**
 * ¿El total puede cambiar según el medio elegido? Sólo si los medios ofrecidos no comparten lista de
 * precios (cada medio apunta a una lista; sin lista rige la general). Con una sola lista distinta el
 * aviso "el total se actualiza" no aporta nada.
 */
export function totalVariaSegunMedio(medios: readonly Pick<MedioPago, "idListaPrecios">[]): boolean {
  return new Set(medios.map((m) => m.idListaPrecios || "")).size > 1;
}

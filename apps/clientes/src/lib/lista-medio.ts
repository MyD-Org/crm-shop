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
import { mediosParaModalidad, type MedioPago, type OpcionesMedios } from "./medios-pago";

export function idListaDelMedio(
  medios: readonly MedioPago[],
  entrega: EntregaTipo,
  slug: string | null | undefined,
  opts?: OpcionesMedios,
): string | undefined {
  if (!slug) return undefined;
  const medio = mediosParaModalidad(medios, entrega, opts).find((m) => m.slug === slug);
  return medio?.idListaPrecios || undefined;
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

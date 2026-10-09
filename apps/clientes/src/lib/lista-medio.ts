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
import { mediosParaModalidad, procesadorDeMedio, type MedioPago, type OpcionesMedios } from "./medios-pago";
import { opcionesAplicables, OPCIONES_COBRO, type OpcionCobro } from "./pagos/opciones-cobro";

/** Procesadores cuyos medios admiten listas distintas por forma de pago (migración 0076 del CRM). */
const PROCESADORES_CON_FORMAS: readonly string[] = ["mercadopago", "payway"];

/**
 * Lista del pago único según la forma de pago. Precedencia: la de la forma > la del medio (forma
 * NULL) > ninguna (rige la lista general). Sin forma NUNCA se toma una lista por forma.
 */
export function listaDelPagoUnico(
  medio: Pick<MedioPago, "idListaPrecios" | "listasPorForma">,
  forma?: OpcionCobro | null,
): string | undefined {
  return (forma ? medio.listasPorForma?.[forma] : undefined) || medio.idListaPrecios || undefined;
}

/** Formas de pago que el medio ofrece, o [] si su procesador no admite precios por forma. */
export function formasDelMedio(medio: Pick<MedioPago, "slug" | "opcionesCobro">): OpcionCobro[] {
  const procesador = procesadorDeMedio(medio.slug);
  if (!procesador || !PROCESADORES_CON_FORMAS.includes(procesador)) return [];
  return opcionesAplicables(procesador, medio.opcionesCobro);
}

/**
 * ¿El medio tiene precios DISTINTOS según la forma de pago? Compara por id de lista (no por total:
 * es conservador). Su único uso es decidir si `orders.forma_cobro` se guarda no nulo al congelar el
 * pedido; el resto de las validaciones se apoyan en esa columna.
 */
export function hayPreciosPorForma(
  medio: Pick<MedioPago, "slug" | "idListaPrecios" | "listasPorForma" | "opcionesCobro">,
): boolean {
  const formas = formasDelMedio(medio);
  if (formas.length < 2) return false;
  return new Set(formas.map((f) => listaDelPagoUnico(medio, f) ?? "")).size > 1;
}

/**
 * Forma con la que nace el pedido de un medio con precios distintos por forma: la primera que el medio
 * ofrece (crédito, débito, cuenta MP). Es la misma que elige `resolverForma` cuando no llega ninguna,
 * así el total que ve el comprador al cotizar coincide con el del pedido. Sin precios por forma, `null`.
 */
export function formaInicialDelMedio(
  medio: Pick<MedioPago, "slug" | "idListaPrecios" | "listasPorForma" | "opcionesCobro">,
): OpcionCobro | null {
  return hayPreciosPorForma(medio) ? (formasDelMedio(medio)[0] ?? null) : null;
}

/**
 * Forma con la que se cotiza y congela el pedido. Una forma pedida inválida o no habilitada para el
 * procesador del medio (p. ej. `cuenta_mp` con Payway) se rechaza siempre. Sin precios distintos por
 * forma da `null` (el pedido no valida la forma). Con ellos, la pedida o, si falta, la primera que el
 * medio ofrece (crédito, débito, cuenta MP): el pedido nace con forma y el cobro no queda sin validar.
 * Un medio que no es de Mercado Pago ni de Payway ignora la forma. `pedida` es la forma pedida ya validada
 * (aunque no se congele), para rechazar cuotas con una forma que no es crédito.
 */
export function resolverForma(
  medio: Pick<MedioPago, "slug" | "idListaPrecios" | "listasPorForma" | "opcionesCobro">,
  pedida: unknown,
): { ok: true; forma: OpcionCobro | null; pedida: OpcionCobro | null } | { ok: false } {
  const procesador = procesadorDeMedio(medio.slug);
  if (!procesador || !PROCESADORES_CON_FORMAS.includes(procesador)) return { ok: true, forma: null, pedida: null };
  const formas = opcionesAplicables(procesador, medio.opcionesCobro);
  const hayPedida = pedida !== undefined && pedida !== null && pedida !== "";
  let forma: OpcionCobro | null = null;
  if (hayPedida) {
    if (typeof pedida !== "string" || !(OPCIONES_COBRO as readonly string[]).includes(pedida)) return { ok: false };
    if (!formas.includes(pedida as OpcionCobro)) return { ok: false };
    forma = pedida as OpcionCobro;
  }
  if (!hayPreciosPorForma(medio)) return { ok: true, forma: null, pedida: forma };
  return { ok: true, forma: forma ?? formas[0] ?? null, pedida: forma };
}

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
  /**
   * Forma de pago (change `listas-por-forma-de-pago`): toma la lista de esa forma del pago único. Sin
   * forma rige solo la del medio. Las cuotas (N >= 2) son crédito y la ignoran.
   */
  forma?: OpcionCobro | null,
): string | undefined {
  if (!slug) return undefined;
  const medio = mediosParaModalidad(medios, entrega, opts).find((m) => m.slug === slug);
  if (!medio) return undefined;
  if (typeof cuotas === "number" && cuotas >= 2) return idListaDeCuotas(medio.condicionesCuotas, cuotas);
  return listaDelPagoUnico(medio, forma);
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
  medioSel: Pick<MedioPago, "idListaPrecios" | "listasPorForma"> | null,
  opts?: OpcionesMedios,
  /** Forma de pago de la pestaña o modalidad activa (change `listas-por-forma-de-pago`). */
  forma?: OpcionCobro | null,
): { listaKey: string; pagoMetodo: string | undefined; formaKey?: OpcionCobro } {
  const listaKey = (medioSel ? listaDelPagoUnico(medioSel, forma) : undefined) ?? "";
  if (!listaKey) return { listaKey: "", pagoMetodo: undefined };
  // La forma solo viaja si su lista difiere de la del medio: así cambiar de pestaña sin precio propio
  // no dispara otra cotización.
  const formaKey = forma && listaKey !== (medioSel?.idListaPrecios || "") ? forma : undefined;
  const canonico = mediosParaModalidad(medios, entrega, opts).find(
    (m) => (listaDelPagoUnico(m, formaKey ?? null) ?? "") === listaKey,
  );
  return { listaKey, pagoMetodo: canonico?.slug, ...(formaKey ? { formaKey } : {}) };
}

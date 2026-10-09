/**
 * "$X con <Medio>" del catálogo y la ficha. Lógica PURA, sin base ni flags.
 *
 * - Cards (catálogo, carruseles, favoritos): sólo el medio DESTACADO (`destacarEnCatalogo`).
 * - Ficha: una línea por cada medio con `mostrarEnFicha`, en el orden del operador.
 * Un medio cuenta si está activo y tiene lista de precios enlazada; la línea de un producto sólo
 * aparece si su precio en esa lista es MENOR que el de la lista por defecto (misma regla que la
 * cotización: `precioDeLista`), así lo que se exhibe coincide con lo que cotiza el checkout.
 */
import { precioDeLista, precioGeneral, type AlegraPrice } from "./alegra";
import type { PrecioMedio, PrecioOffline } from "@/data/products";
import { cuotasNoAlcanzadas, opcionesCuotas, type CuotasProducto, type MedioCuotas } from "./cuotas-sin-interes";
import { formasDelMedio } from "./lista-medio";
import type { OpcionCobro } from "./pagos/opciones-cobro";
import { SLUGS_RESERVADOS, esMedioCuentaCorriente, type MedioPago } from "./medios-pago";
import { precioFinal } from "./precio-final";

/** Un medio a exhibir con precio: lo mínimo que viaja a las funciones cacheadas (parte de la clave). */
export interface MedioPrecio {
  slug: string;
  nombre: string;
  /** Lista del medio (la que rige para toda forma sin lista propia); '' = ninguna. */
  idListaPrecios: string;
  /**
   * Listas por forma de pago (change `listas-por-forma-de-pago`): una entrada por cada forma que el
   * procesador del medio ofrece, en el orden crédito, débito, cuenta MP, con la lista que le toca (la
   * propia o, si no tiene, la del medio; '' = ninguna). Ausente = el medio no tiene precios por forma.
   * Forma parte de la clave de las cachés: no se mezclan formas.
   */
  listasPorForma?: { forma: OpcionCobro; idListaPrecios: string }[];
}

export interface MediosPrecio {
  /** Medio de las cards; `null` = ninguno. */
  destacado: MedioPrecio | null;
  /** Medios de la ficha, ya ordenados. */
  ficha: MedioPrecio[];
  /**
   * Cuotas sin interés (rebanada D, con el flag `cuotas-cobro`): TODOS los medios de cobro en línea
   * elegibles y sus condiciones, en el orden del admin. Ausente = no hay cuotas que mostrar. Es parte de la clave de las cachés.
   */
  cuotas?: MedioCuotas[];
  /**
   * Medios con cobro en línea y listas por forma de pago, para el modal "Ver medios de pago": NO
   * depende de `mostrarEnFicha` ni de `destacarEnCatalogo`. Ausente = ninguno. Parte de la clave de las cachés.
   */
  modal?: MedioPrecio[];
  /**
   * Medios SIN cobro en línea (transferencia, efectivo en el local…), activos, públicos y que aplican a
   * retiro o envío, para el modal "Ver medios de pago": un bloque por medio con su precio en 1 pago. NO
   * depende de `mostrarEnFicha` ni de `destacarEnCatalogo`, y entran aunque no tengan lista. Ausente =
   * ninguno. Parte de la clave de las cachés.
   */
  offline?: MedioPrecio[];
}

export const SIN_MEDIOS_PRECIO: MediosPrecio = { destacado: null, ficha: [] };

function porOrden(a: MedioPago, b: MedioPago): number {
  return a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es") || a.slug.localeCompare(b.slug);
}

/**
 * Qué medios exhibir. Con el flag `precio-especial-cuenta` ENCENDIDO el precio vuelve a depender de
 * la lista del cliente y no conviven las líneas "con X": vacío.
 */
export function seleccionarMediosPrecio(
  medios: readonly MedioPago[],
  especialEncendido: boolean,
  /** Flag `cuotas-cobro`: sin él no se exhiben cuotas. */
  cuotasEncendido = false,
): MediosPrecio {
  if (especialEncendido) return SIN_MEDIOS_PRECIO;
  const elegibles = medios
    .filter(
      (m) =>
        m.activo &&
        (Boolean(m.idListaPrecios) || listasDeLasFormas(m) !== null) &&
        !SLUGS_RESERVADOS.includes(m.slug) &&
        !esMedioCuentaCorriente(m),
    )
    .sort(porOrden);
  const aMedio = (m: MedioPago): MedioPrecio => {
    const listasPorForma = listasDeLasFormas(m);
    return {
      slug: m.slug,
      nombre: m.nombre,
      idListaPrecios: m.idListaPrecios ?? "",
      ...(listasPorForma ? { listasPorForma } : {}),
    };
  };
  const destacado = elegibles.find((m) => m.destacarEnCatalogo);
  const cuotas = cuotasEncendido ? mediosCuotas(medios) : [];
  const modal = elegibles.filter((m) => m.cobroOnline && listasDeLasFormas(m) !== null).map(aMedio);
  const offline = medios
    .filter(
      (m) =>
        m.activo &&
        !m.cobroOnline &&
        (m.aplicaRetiro || m.aplicaEnvio) &&
        !SLUGS_RESERVADOS.includes(m.slug) &&
        !esMedioCuentaCorriente(m),
    )
    .sort(porOrden)
    .map(aMedio);
  return {
    destacado: destacado ? aMedio(destacado) : null,
    ficha: elegibles.filter((m) => m.mostrarEnFicha).map(aMedio),
    ...(cuotas.length > 0 ? { cuotas } : {}),
    ...(modal.length > 0 ? { modal } : {}),
    ...(offline.length > 0 ? { offline } : {}),
  };
}

/**
 * Lista de cada forma de pago del medio, o `null` si no tiene precios por forma (ninguna fila propia
 * para una forma que su procesador ofrece). Una forma sin fila hereda la lista del medio.
 */
function listasDeLasFormas(m: MedioPago): { forma: OpcionCobro; idListaPrecios: string }[] | null {
  const formas = formasDelMedio(m);
  if (!formas.some((f) => m.listasPorForma?.[f])) return null;
  return formas.map((forma) => ({ forma, idListaPrecios: m.listasPorForma?.[forma] || m.idListaPrecios || "" }));
}

/**
 * Los medios que cobran en cuotas: activos, con cobro en línea y condiciones de 2..24 cuotas, en el
 * orden del admin. `medios` ya viene sin los procesadores sin credenciales (`mediosOfrecibles`), así
 * que un medio que el checkout no ofrece tampoco se exhibe. Sin condiciones no hay nada que ofrecer.
 */
function mediosCuotas(medios: readonly MedioPago[]): MedioCuotas[] {
  return medios
    .filter((x) => x.activo && x.cobroOnline && !esMedioCuentaCorriente(x) && !SLUGS_RESERVADOS.includes(x.slug) && (x.condicionesCuotas?.length ?? 0) > 0)
    .sort(porOrden)
    .map((m) => ({
      slug: m.slug,
      nombre: m.nombre,
      condiciones: [...(m.condicionesCuotas ?? [])].sort((a, b) => a.cuotas - b.cuotas),
      idListaPagoUnico: m.idListaPrecios,
    }));
}

function precioDeUnaLista(prices: AlegraPrice[], iva: number | null, medio: MedioPrecio, idLista: string, forma?: OpcionCobro): PrecioMedio | null {
  const general = precioGeneral(prices);
  const price = precioDeLista(prices, idLista);
  // `precioDeLista` cae al general cuando la lista no aplica: sin descuento no hay línea.
  if (!(price > 0) || price >= general) return null;
  const final = precioFinal(price, iva);
  return {
    slug: medio.slug,
    nombre: medio.nombre,
    price,
    ...(final != null ? { precioFinal: final } : {}),
    ...(forma ? { forma } : {}),
  };
}

const aLista = (p: PrecioMedio | null): PrecioMedio[] => (p ? [p] : []);

/**
 * Card: la lista del medio si la tiene (como siempre). Si no tiene pero sí listas por forma, la forma
 * MÁS BARATA, con su `forma` para rotular ("con débito"). Con empate gana la primera en el orden
 * crédito, débito, cuenta MP.
 */
function precioDestacado(prices: AlegraPrice[], iva: number | null, medio: MedioPrecio): PrecioMedio | null {
  if (medio.idListaPrecios || !medio.listasPorForma) return precioDeUnaLista(prices, iva, medio, medio.idListaPrecios);
  let mejor: PrecioMedio | null = null;
  for (const { forma, idListaPrecios } of medio.listasPorForma) {
    const p = precioDeUnaLista(prices, iva, medio, idListaPrecios, forma);
    if (p && (!mejor || p.price < mejor.price)) mejor = p;
  }
  return mejor;
}

/**
 * Ficha: una línea por medio, o una por forma SOLO si los precios de las formas difieren (se compara
 * el precio efectivo de la lista de cada una). Si coinciden, una sola línea, como siempre; sin forma
 * rotulada porque vale para todas. Una forma sin descuento respecto de la lista general no tiene línea.
 */
function preciosDeLaFicha(prices: AlegraPrice[], iva: number | null, medio: MedioPrecio): PrecioMedio[] {
  if (!medio.listasPorForma) return aLista(precioDeUnaLista(prices, iva, medio, medio.idListaPrecios));
  const efectivos = medio.listasPorForma.map((f) => precioDeLista(prices, f.idListaPrecios));
  if (efectivos.every((p) => p === efectivos[0])) {
    return aLista(precioDeUnaLista(prices, iva, medio, medio.listasPorForma[0].idListaPrecios));
  }
  return medio.listasPorForma.flatMap((f) => precioDeUnaLista(prices, iva, medio, f.idListaPrecios, f.forma) ?? []);
}

/**
 * `precioMedio` (card) y `preciosMedios` (ficha) de un producto. Sin `medios` no suma ningún campo;
 * `preciosMedios` queda definido (posiblemente vacío) apenas se pasan medios.
 */
export function armarPreciosMedios(
  prices: AlegraPrice[],
  iva: number | null,
  medios: MediosPrecio | undefined,
): { precioMedio?: PrecioMedio; preciosMedios?: PrecioMedio[]; preciosFormaModal?: PrecioMedio[]; preciosOfflineModal?: PrecioOffline[]; cuotasSinInteres?: CuotasProducto } {
  if (!medios) return {};
  const precioMedio = medios.destacado ? precioDestacado(prices, iva, medios.destacado) : null;
  const preciosMedios = medios.ficha.flatMap((m) => preciosDeLaFicha(prices, iva, m));
  // Líneas por forma para el modal: con la misma regla de precio que la ficha, pero de todos los medios con cobro en línea.
  const preciosFormaModal = (medios.modal ?? []).flatMap((m) => preciosDeLaFicha(prices, iva, m)).filter((p) => p.forma);
  // Medios sin cobro en línea para el modal: precio de su lista con la regla de la ficha (`precioDeLista`:
  // una lista más cara que la de referencia, o ninguna, da el precio de referencia).
  const preciosOfflineModal = (medios.offline ?? []).flatMap((m): PrecioOffline[] => {
    const price = precioDeLista(prices, m.idListaPrecios || undefined);
    const final = precioFinal(price, iva);
    return final != null ? [{ slug: m.slug, nombre: m.nombre, precioFinal: final }] : [];
  });
  // Mínimos por medio: cada uno compara contra la lista del pago único del suyo.
  const cuotasMedios = (medios.cuotas ?? []).flatMap((m) => {
    const opciones = opcionesCuotas(prices, iva, m);
    const noAlcanzadas = cuotasNoAlcanzadas(prices, iva, m);
    return opciones.length > 0 || noAlcanzadas.length > 0
      ? [{ slug: m.slug, medio: m.nombre, opciones, ...(noAlcanzadas.length > 0 ? { noAlcanzadas } : {}) }]
      : [];
  });
  return {
    ...(precioMedio ? { precioMedio } : {}),
    preciosMedios,
    ...(preciosFormaModal.length > 0 ? { preciosFormaModal } : {}),
    ...(preciosOfflineModal.length > 0 ? { preciosOfflineModal } : {}),
    ...(cuotasMedios.length > 0 ? { cuotasSinInteres: { medios: cuotasMedios } } : {}),
  };
}

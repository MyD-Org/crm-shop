/**
 * Textos y derivaciones de PRESENTACIÓN del catálogo: migas, título,
 * contador, chips de filtros activos, etiqueta de stock, indexabilidad.
 *
 * Módulo puro (sin React ni DB): el Shop no tiene tests de render (vitest en
 * node), así que todo lo que el catálogo muestra y se puede calcular vive
 * acá, con tests. Los componentes de src/components/catalogo sólo lo pintan
 * con el design system.
 *
 * Copy en español formal de usted (CLAUDE.md).
 */
import type { BreadcrumbItem } from "@myd-org/ui";
import type { Product } from "@/data/products";
import { fmtPesosEnteros } from "@/lib/format";
import { formatMarca, formatRubro } from "@/lib/formato-rubro";
import {
  ORDEN_DEFAULT,
  SOLO_STOCK_DEFAULT,
  VISTA_DEFAULT,
  rangoEfectivo,
  type EstadoCatalogo,
  type OrdenCatalogo,
  type RangoPrecio,
} from "@/lib/catalogo-url";

/** Pesos sin decimales, para los bordes del filtro de precio (ver `fmtPesosEnteros`). */
export const fmtPesos = fmtPesosEnteros;

const miles = new Intl.NumberFormat("es-AR");

/**
 * Ubicación: Inicio / Catálogo [/ rubro | / Resultados]. El rubro sólo con
 * UNA categoría tildada (con dos no hay un "dónde estoy" único); con búsqueda
 * el último tramo es "Resultados". El DS marca el último ítem como actual.
 */
export function migas(estado: EstadoCatalogo): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    { label: "Inicio", href: "/" },
    { label: "Catálogo", href: "/catalogo" },
  ];
  if (estado.query) items.push({ label: "Resultados" });
  else if (estado.categorias.length === 1)
    items.push({ label: formatRubro(estado.categorias[0]) });
  return items;
}

/**
 * Opciones de orden, en el orden en que se ofrecen. Vive acá y no en un
 * componente porque la usan los dos lugares donde se elige el orden: los
 * controles de la grilla en desktop y la hoja de filtros en mobile.
 *
 * Sin "Más vendidos": nunca hubo un dato de ventas detrás (ordenaba por nombre).
 */
export const ORDENES: { label: string; value: OrdenCatalogo }[] = [
  { label: "Nombre A-Z", value: "nombre" },
  { label: "Precio: menor a mayor", value: "precio-asc" },
  { label: "Precio: mayor a menor", value: "precio-desc" },
];

/** Título de la página: la búsqueda gana; si no, la categoría única. */
export function tituloCatalogo(estado: EstadoCatalogo): string {
  if (estado.query) return `Resultados para "${estado.query}"`;
  if (estado.categorias.length === 1) return formatRubro(estado.categorias[0]);
  return "Catálogo";
}

const productos = (n: number) =>
  `${miles.format(n)} ${n === 1 ? "producto" : "productos"}`;

/** Bajada del título: "2.626 productos · página 2 de 110". */
export function contadorProductos(total: number, pagina: number, paginas: number): string {
  if (total === 0) return "Sin productos";
  return paginas > 1
    ? `${productos(total)} · página ${pagina} de ${paginas}`
    : productos(total);
}

/** Texto del `role="status"` para lectores de pantalla. */
export function anuncioResultados(
  mostrados: number,
  total: number,
  pagina: number,
  paginas: number
): string {
  if (total === 0) return "Sin resultados";
  return `Mostrando ${mostrados} de ${productos(total)}, página ${pagina} de ${paginas}`;
}

/**
 * Etiqueta de stock cuando quedan pocas unidades y se sabe cuántas. En el
 * resto de los casos `undefined`: el DS pone "En stock" / "Últimas
 * unidades" / "Sin stock".
 */
export function etiquetaStock(p: Pick<Product, "stock" | "stockQty">): string | undefined {
  const n = unidadesPositivas(p);
  return p.stock === "low" && n != null ? `¡Últimas ${n}!` : undefined;
}

/**
 * Cantidad que se puede mostrar: conocida y mayor a cero, y sólo si el
 * producto no figura sin stock.
 */
function unidadesPositivas(p: Pick<Product, "stock" | "stockQty">): number | undefined {
  const n = p.stockQty;
  return p.stock !== "out" && n != null && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "12 disponibles" / "1 disponible" junto al estado de stock de la ficha; si no, nada. */
export function textoUnidadesDisponibles(
  p: Pick<Product, "stock" | "stockQty">
): string | undefined {
  const n = unidadesPositivas(p);
  if (n == null) return undefined;
  return `${miles.format(n)} ${n === 1 ? "disponible" : "disponibles"}`;
}

/** Tope de los selectores de cantidad cuando no se conoce el stock. */
export const CANTIDAD_MAXIMA = 999;

/**
 * Cuántas unidades deja elegir el selector de cantidad: las disponibles si se
 * conocen; si no (ítem no inventariable), el tope general.
 */
export function maxCantidad(p: Pick<Product, "stock" | "stockQty">): number {
  return unidadesPositivas(p) ?? CANTIDAD_MAXIMA;
}

/** Un chip de filtro activo y el cambio de estado que lo quita. */
export interface ChipFiltro {
  /** Única entre los chips: sirve de `key`. */
  clave: string;
  etiqueta: string;
  removeLabel: string;
  cambios: Partial<EstadoCatalogo>;
}

const hayPrecio = (e: Pick<EstadoCatalogo, "precioMin" | "precioMax">) =>
  e.precioMin != null || e.precioMax != null;

function etiquetaPrecio(estado: EstadoCatalogo, rango: RangoPrecio | null): string {
  if (rango) {
    const [min, max] = rangoEfectivo(estado, rango);
    return `Precio: ${fmtPesos(min)} – ${fmtPesos(max)}`;
  }
  // Sin rango real (conjunto vacío) no hay límites contra qué completar.
  if (estado.precioMin != null && estado.precioMax != null)
    return `Precio: ${fmtPesos(estado.precioMin)} – ${fmtPesos(estado.precioMax)}`;
  return estado.precioMin != null
    ? `Precio: desde ${fmtPesos(estado.precioMin)}`
    : `Precio: hasta ${fmtPesos(estado.precioMax ?? 0)}`;
}

/**
 * "Solo con stock" prendido es el default y no se muestra como chip. Apagado
 * sí: el chip "Incluye sin stock" permite volver al default.
 */
const ETIQUETA_INCLUYE_SIN_STOCK = "Incluye sin stock";

/** ¿"Solo con stock" está fuera de su default? (cuenta como filtro activo). */
const stockFueraDeDefault = (e: Pick<EstadoCatalogo, "soloStock">) =>
  e.soloStock !== SOLO_STOCK_DEFAULT;

/** Chips de filtros activos, en el orden del panel: categorías → marcas → precio → stock. */
export function chipsActivos(estado: EstadoCatalogo, rango: RangoPrecio | null): ChipFiltro[] {
  const chip = (clave: string, etiqueta: string, cambios: Partial<EstadoCatalogo>) => ({
    clave,
    etiqueta,
    removeLabel: `Quitar filtro ${etiqueta}`,
    cambios,
  });
  return [
    ...estado.categorias.map((c) =>
      chip(`categoria:${c}`, formatRubro(c), {
        categorias: estado.categorias.filter((x) => x !== c),
      })
    ),
    ...estado.marcas.map((m) =>
      chip(`marca:${m}`, `Marca: ${formatMarca(m)}`, { marcas: estado.marcas.filter((x) => x !== m) })
    ),
    ...(hayPrecio(estado)
      ? [
          chip("precio", etiquetaPrecio(estado, rango), {
            precioMin: undefined,
            precioMax: undefined,
          }),
        ]
      : []),
    ...(stockFueraDeDefault(estado)
      ? [chip("stock", ETIQUETA_INCLUYE_SIN_STOCK, { soloStock: SOLO_STOCK_DEFAULT })]
      : []),
  ];
}

/**
 * Cambios que vuelven los filtros a su default ("Solo con stock" prendido).
 * La búsqueda, el orden y la vista no se nombran, así que `hrefCon` los
 * conserva.
 */
export function limpiarFiltros(): Partial<EstadoCatalogo> {
  return {
    categorias: [],
    marcas: [],
    precioMin: undefined,
    precioMax: undefined,
    soloStock: SOLO_STOCK_DEFAULT,
  };
}

/** ¿Hay algún filtro del panel aplicado? (la búsqueda no cuenta). */
export function hayFiltros(estado: EstadoCatalogo): boolean {
  return contarFiltrosActivos(estado) > 0;
}

/** Filtros activos para el contador del botón "Filtros" en mobile. */
export function contarFiltrosActivos(estado: EstadoCatalogo): number {
  return (
    estado.categorias.length +
    estado.marcas.length +
    (hayPrecio(estado) ? 1 : 0) +
    (stockFueraDeDefault(estado) ? 1 : 0)
  );
}

/**
 * Nombre accesible del botón "Filtros" de mobile: "Filtros (5)" con filtros
 * activos, "Filtros" sin ellos. El número también se ve en un `Badge`.
 */
export function etiquetaBotonFiltros(activos: number): string {
  return activos > 0 ? `Filtros (${activos})` : "Filtros";
}

/**
 * ¿Esta combinación merece estar en el índice de los buscadores? Sólo
 * `/catalogo`, una categoría y sus páginas (con "Solo con stock" en su
 * default); el resto (búsquedas, marcas, precio, incluir sin stock, orden,
 * vista, varias categorías) queda `noindex, follow`:
 * siguen siendo URLs compartibles, pero no se multiplican en el índice.
 */
export function indexable(estado: EstadoCatalogo): boolean {
  return (
    !estado.query &&
    estado.marcas.length === 0 &&
    !hayPrecio(estado) &&
    !stockFueraDeDefault(estado) &&
    estado.orden === ORDEN_DEFAULT &&
    estado.vista === VISTA_DEFAULT &&
    estado.categorias.length <= 1
  );
}

/**
 * Ítems de una faceta con su tilde. Un valor tildado que la faceta ya no trae
 * (porque, cruzado con los otros filtros, cuenta cero) se agrega primero con
 * cuenta 0: si desapareciera del panel, sólo se podría quitar desde el chip.
 */
export function itemsDeFaceta<F extends { label: string; count: number }>(
  facetas: F[],
  tildados: string[],
): ((F | { label: string; count: number }) & { checked: boolean })[] {
  const presentes = new Set(facetas.map((f) => f.label));
  const ausentes = tildados
    .filter((t) => !presentes.has(t))
    .map((label) => ({ label, count: 0, checked: true }));
  return [
    ...ausentes,
    ...facetas.map((f) => ({ ...f, checked: tildados.includes(f.label) })),
  ];
}

/**
 * Nueva selección de categorías al tildar o destildar `valor`. Tildar una
 * madre ya filtra por toda su rama (ver `filtroCategoriasSql`), así que sus
 * hijas tildadas se sacan: quedarían repetidas en la URL y en los chips.
 * `facetas` va en orden de lectura (cada madre seguida de sus hijas).
 */
export function alternarCategoria(
  facetas: { label: string; nivel?: number }[],
  seleccion: string[],
  valor: string,
  tildado: boolean,
): string[] {
  if (!tildado) return seleccion.filter((x) => x !== valor);
  const i = facetas.findIndex((f) => f.label === valor);
  const hijas = new Set<string>();
  if (i >= 0) {
    const nivel = facetas[i].nivel ?? 1;
    for (let j = i + 1; j < facetas.length && (facetas[j].nivel ?? 1) > nivel; j++) {
      hijas.add(facetas[j].label);
    }
  }
  return [...seleccion.filter((x) => x !== valor && !hijas.has(x)), valor];
}

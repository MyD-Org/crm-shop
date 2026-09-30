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
import { nombreAtributo } from "@/lib/catalogo-atributos";
import {
  ORDEN_DEFAULT,
  SOLO_STOCK_DEFAULT,
  VISTA_DEFAULT,
  consultaInterpretada,
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
  if (estado.query || interpretacionVigente(estado)) items.push({ label: "Resultados" });
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
  { label: "Relevancia", value: "relevancia" },
  { label: "Nombre A-Z", value: "nombre" },
  { label: "Precio: menor a mayor", value: "precio-asc" },
  { label: "Precio: mayor a menor", value: "precio-desc" },
];

/**
 * Órdenes que se ofrecen para un estado: "Relevancia" sólo con búsqueda (o si
 * ya es el orden vigente: con `filtrosSinBusqueda` el panel recibe el estado
 * sin `query`, y el Select no puede quedar sin la opción elegida).
 */
export function ordenesPara(estado: Pick<EstadoCatalogo, "query" | "orden">) {
  return estado.query || estado.orden === "relevancia"
    ? ORDENES
    : ORDENES.filter((o) => o.value !== "relevancia");
}

/**
 * La consulta original de una búsqueda interpretada (`?ia=`), mientras siga
 * habiendo algo de lo que salió de ella (texto, categorías o atributos). Si el
 * visitante quitó todo, el estado ya no es "lo que entendimos" de nada.
 */
export function interpretacionVigente(estado: EstadoCatalogo): string | undefined {
  const consulta = consultaInterpretada(estado);
  if (!consulta) return undefined;
  return estado.query || estado.categorias.length || estado.atributos.length ? consulta : undefined;
}

/**
 * Título de la página: la búsqueda gana (la que escribió el visitante, aunque
 * se haya interpretado en filtros); si no, la categoría única.
 */
export function tituloCatalogo(estado: EstadoCatalogo): string {
  const interpretada = interpretacionVigente(estado);
  if (interpretada) return `Resultados para "${interpretada}"`;
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
 * Etiqueta de stock cuando quedan pocas unidades y se sabe cuántas: "Quedan
 * 3", un dato y no una alarma. En el resto de los casos `undefined`: el DS
 * pone "Últimas unidades" / "Sin stock" (las cards ya no muestran "En
 * stock": ver `mostrarStockEnCard`).
 */
export function etiquetaStock(p: Pick<Product, "stock" | "stockQty">): string | undefined {
  const n = unidadesPositivas(p);
  if (p.stock !== "low" || n == null) return undefined;
  return n === 1 ? "Queda 1" : `Quedan ${miles.format(n)}`;
}

/**
 * ¿La card muestra el estado de stock? Sólo cuando es una excepción (pocas
 * unidades o sin stock): "En stock" en cada card de la grilla es ruido.
 */
export function mostrarStockEnCard(p: Pick<Product, "stock">): boolean {
  return p.stock !== "in";
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

const hayPotencia = (e: Pick<EstadoCatalogo, "potenciaMin" | "potenciaMax">) =>
  e.potenciaMin != null || e.potenciaMax != null;

const watts = (n: number) => `${n.toLocaleString("es-AR")} W`;

/** "Potencia: 10 – 50 W", "Potencia: desde 10 W", "Potencia: hasta 50 W". */
function etiquetaPotencia(estado: EstadoCatalogo): string {
  if (estado.potenciaMin != null && estado.potenciaMax != null)
    return `Potencia: ${estado.potenciaMin.toLocaleString("es-AR")} – ${watts(estado.potenciaMax)}`;
  return estado.potenciaMin != null
    ? `Potencia: desde ${watts(estado.potenciaMin)}`
    : `Potencia: hasta ${watts(estado.potenciaMax ?? 0)}`;
}

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

/** Local de retiro para el filtro "Con stock en <local>" (slug + nombre para el texto). */
export interface LocalFiltro {
  slug: string;
  nombre: string;
}

/**
 * Chips de filtros activos, en el orden del panel: categorías → marcas →
 * características (atributos) → potencia → precio → stock.
 * `locales` pone el nombre del local en el chip de "Con stock en"; sin él se muestra el slug.
 */
export function chipsActivos(
  estado: EstadoCatalogo,
  rango: RangoPrecio | null,
  locales: LocalFiltro[] = [],
): ChipFiltro[] {
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
    ...estado.atributos.map((a) =>
      chip(`atributo:${a}`, nombreAtributo(a), { atributos: estado.atributos.filter((x) => x !== a) })
    ),
    ...(hayPotencia(estado)
      ? [chip("potencia", etiquetaPotencia(estado), { potenciaMin: undefined, potenciaMax: undefined })]
      : []),
    ...(hayPrecio(estado)
      ? [
          chip("precio", etiquetaPrecio(estado, rango), {
            precioMin: undefined,
            precioMax: undefined,
          }),
        ]
      : []),
    ...(estado.retiroEn
      ? [
          chip(
            "retiro",
            `Con stock en ${locales.find((l) => l.slug === estado.retiroEn)?.nombre ?? estado.retiroEn}`,
            { retiroEn: undefined },
          ),
        ]
      : stockFueraDeDefault(estado)
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
    atributos: [],
    precioMin: undefined,
    precioMax: undefined,
    potenciaMin: undefined,
    potenciaMax: undefined,
    soloStock: SOLO_STOCK_DEFAULT,
    retiroEn: undefined,
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
    estado.atributos.length +
    (hayPrecio(estado) ? 1 : 0) +
    (hayPotencia(estado) ? 1 : 0) +
    (estado.retiroEn || stockFueraDeDefault(estado) ? 1 : 0)
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
    !estado.ia &&
    estado.marcas.length === 0 &&
    estado.atributos.length === 0 &&
    !hayPrecio(estado) &&
    !hayPotencia(estado) &&
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

/** Índices de las hijas directas de `facetas[i]` (orden de lectura). */
function hijasDirectas(facetas: { label: string; nivel?: number }[], i: number): number[] {
  const nivel = facetas[i].nivel ?? 1;
  const hijas: number[] = [];
  for (let j = i + 1; j < facetas.length && (facetas[j].nivel ?? 1) > nivel; j++) {
    if ((facetas[j].nivel ?? 1) === nivel + 1) hijas.push(j);
  }
  return hijas;
}

/** Índices de las madres de `facetas[i]`, de la más cercana a la raíz. */
function madresDe(facetas: { label: string; nivel?: number }[], i: number): number[] {
  const madres: number[] = [];
  let nivel = facetas[i].nivel ?? 1;
  for (let j = i - 1; j >= 0 && nivel > 1; j--) {
    const n = facetas[j].nivel ?? 1;
    if (n < nivel) {
      madres.push(j);
      nivel = n;
    }
  }
  return madres;
}

/**
 * Nueva selección de categorías al tildar o destildar `valor`. Tildar una
 * madre ya filtra por toda su rama (ver `filtroCategoriasSql`), así que sus
 * hijas tildadas se sacan: quedarían repetidas en la URL y en los chips.
 * `facetas` va en orden de lectura (cada madre seguida de sus hijas).
 *
 * Destildar una hija que está cubierta por una madre tildada (el filtro la
 * muestra tildada y clicable) saca a la madre y deja tildadas las demás
 * hermanas de cada nivel del camino: "toda Iluminación menos Tubos".
 */
export function alternarCategoria(
  facetas: { label: string; nivel?: number }[],
  seleccion: string[],
  valor: string,
  tildado: boolean,
): string[] {
  if (!tildado) {
    if (seleccion.includes(valor)) return seleccion.filter((x) => x !== valor);
    const iValor = facetas.findIndex((f) => f.label === valor);
    if (iValor < 0) return seleccion;
    const madres = madresDe(facetas, iValor);
    const cubridora = madres.find((m) => seleccion.includes(facetas[m].label));
    if (cubridora == null) return seleccion;
    // Camino desde la madre tildada hasta la hija: en cada nivel quedan
    // tildadas las hermanas que no están en el camino.
    const camino = new Set([...madres, iValor]);
    const agregadas: string[] = [];
    let actual = cubridora;
    while (actual !== iValor) {
      const hijas = hijasDirectas(facetas, actual);
      const siguiente = hijas.find((h) => camino.has(h));
      for (const h of hijas) if (h !== siguiente) agregadas.push(facetas[h].label);
      if (siguiente == null) break;
      actual = siguiente;
    }
    return [...seleccion.filter((x) => x !== facetas[cubridora].label), ...agregadas];
  }
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

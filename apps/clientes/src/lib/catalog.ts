/**
 * Capa de catálogo: adapta el catálogo a la forma `Product` que el shop ya
 * renderiza (ver src/data/products.ts y el ProductCard del DS).
 *
 * De dónde sale cada cosa (ver docs/arquitectura-integraciones.md):
 * - TODO el producto (nombre, descripción, código, marca, categoría de Alegra,
 *   IVA, precios, stock y estado) → las vistas del CRM
 *   `public.catalog_products_shop` (`crmCatalogo`) y
 *   `public.catalog_categories_shop` (`crmCategoriasAlegra`). Las mantienen la
 *   sync diaria del CRM y los webhooks de Alegra. El Shop no tiene copia propia
 *   ni sync del catálogo. Alegra topea en 30 items por request y el catálogo
 *   tiene miles: no se puede paginar en vivo.
 * - Las vistas son de TODOS los tenants: toda consulta tiene de base
 *   `crmCatalogo` con `enTenantCatalogo()` en el WHERE, y el join a las
 *   categorías de Alegra lleva el tenant en el ON (ver catalogo-fuente.ts y la
 *   guarda catalogo-tenant.test.ts).
 * - Ficha, carrito, checkout y pedido → la misma vista: valen los precios que
 *   publica la tienda (ver src/lib/cotizacion.ts).
 * - Curaduría (nombre, fotos, visibilidad, categoría propia) → overlay y árbol
 *   del CRM (`catalog_overlay`, `shop_categories`).
 * - El stock es el DISPONIBLE: se le resta lo reservado por pedidos vivos del
 *   Shop (ver src/lib/stock-disponible.ts). Toda consulta hace
 *   `.leftJoin(...joinStock(disp))` para eso (la reserva, o con stock por
 *   sucursal el disponible por sucursal; ver src/lib/stock-sucursal.ts).
 *
 * SOLO servidor: usa la DB y el cliente de Alegra. Consumir desde Server
 * Components o API routes, nunca desde el browser.
 *
 * Los campos de marketing (oldPrice, discount, badge) NO vienen de Alegra: son
 * concepto del shop y viven en su propia capa.
 */

import { cache } from "react";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ProductStock } from "@myd-org/ui";
import { getDb } from "@/db";
import {
  crmAtributos,
  crmCatalogo,
  crmCategorias,
  crmCategoriasAlegra,
  crmOverlay,
  type FichaTecnicaCrm,
  type FotoCrm,
} from "@/db/crm";
import { mapPrecios, precioDeLista } from "./alegra";
import { esIdProducto } from "./id-producto";
import { activoSql, preciosSql, stockSql } from "./stock-disponible";
import { enListado, enTenantCatalogo, joinCategoriasAlegra } from "./catalogo-fuente";
import { ORDEN_DEFAULT, type OrdenCatalogo, type RangoPrecio } from "./catalogo-url";
import { fotosPermitidas, hostsDeMedios } from "./catalogo-medios";
import {
  PATRON_CATEGORIA_ACCESORIO,
  PATRON_NOMBRE_ACCESORIO,
  idsCategoriasAccesorio,
  literalUuids,
  ordenIntercaladoArbol,
} from "./catalogo-destacados";
import { basePublicaMedios } from "./shop-media";
import { shopTenantId } from "./tenant";
import { precioFinal } from "./precio-final";
import {
  descripcionExhibida,
  joinOverlay,
  nombreExhibido,
  nombreExhibidoSql,
} from "./nombre-exhibido";
import {
  formasTermino,
  normalizarCodigo,
  patronLike,
  patronPrefijo,
  raizPlural,
  terminosBusqueda,
} from "./catalogo-busqueda";
import type { OpcionFicha, Product } from "@/data/products";
import { resumirVariantes } from "./variantes-ficha";
import { contextoUnion, type ContextoDisponibilidad } from "./disponibilidad-contexto";
import { modalidadPorId, type VentaSinStock } from "./venta-sin-stock";
import { modalidadesActivas } from "./venta-sin-stock-repo";
import { armarPreciosMedios, type MediosPrecio } from "./medios-precio";
import { campaniaParaExhibir } from "./campanias/exhibicion";
import { mapCampanias } from "./campanias/precio";
import { quedanParaEntradas } from "./campanias/unidades";
import { disponibleSucursalSql, joinStock, stockSucursalSql, visibleEnSucursalSql } from "./stock-sucursal";
import {
  columnasConteoAtributos,
  contradiccionSql,
  cumpleAtributoSql,
  contradiceAtributoSql as contradiceIdAtributoSql,
  facetasDeConteos,
  filtroAtributosSql,
  criterioSql,
  tieneClaveSql,
  type ContextoAtributos,
} from "./catalogo-atributos-sql";
import type { CriterioEstructurado } from "./catalogo-atributos";
import { caracteristicasDe, leerAtributosEstructurados, type ClaveEstructurada } from "./catalogo-caracteristicas";
import {
  columnasCumpleSql,
  condicionesPorClave,
  consultaFacetasPorTipoSql,
  entradaDeFilas,
  filtroCaracteristicasSql,
  type ContextoCar,
  type FilaFacetasPorTipo,
} from "./catalogo-facetas-sql";
import { elegirFacetas, type FacetaClave } from "./catalogo-facetas-registro";
import { universoAcotado } from "./busqueda-v2/universo-acotado";
import { acotarPorDeducidas, condicionAmplia, condicionRecuperar, terminosQueRecuperan } from "./busqueda-v2/recuperar";
import { puntajeBusqueda } from "./busqueda-v2/ordenar";
import { patronTermino, type CriterioPlan, type PiezasBusqueda } from "./busqueda-v2/piezas";

/** Debajo de esta cantidad, el stock se muestra como "bajo". */
const STOCK_BAJO = 5;

/**
 * Deriva el estado de stock del shop a partir de una cantidad de inventario.
 * - null/undefined (servicio / no inventariable) → siempre disponible.
 * - >= STOCK_BAJO = "in", >0 = "low", 0 = "out".
 */
export function derivarStock(qty: number | null | undefined): ProductStock {
  if (qty == null) return "in";
  if (qty <= 0) return "out";
  if (qty < STOCK_BAJO) return "low";
  return "in";
}

// ---------------------------------------------------------------------------
// Lectura desde el catálogo del CRM
// ---------------------------------------------------------------------------

/** Fila del join productos × categorías × overlay, tal como la devuelve la query. */
interface FilaCatalogo {
  alegraId: string;
  name: string;
  code: string | null;
  description: string | null;
  brand: string | null;
  /** Crudos de Alegra (vista del CRM): se normalizan con `mapPrecios`. */
  prices: unknown;
  stock: string | null;
  /** numeric de Postgres: llega como string. null = sin IVA conocido. */
  ivaPorcentaje: string | null;
  categoryName: string | null;
  /** Categoría asignada en el admin. Opcional por los fixtures de test (como `overlayFichaTecnica`). */
  overlayCategoriaId?: string | null;
  /** Nombre curado en el CRM. null = sin fila de overlay o sin nombre. */
  overlayNombre: string | null;
  /** Descripción curada en el CRM; pisa la de Alegra. Opcional por los fixtures de test. */
  overlayDescripcion?: string | null;
  /** Fotos del overlay, con la key de R2. null = sin fila de overlay (left join). */
  overlayFotos: FotoCrm[] | null;
  /**
   * Ficha técnica del overlay, con la key de R2. null = sin overlay o sin ficha cargada.
   * Opcional (no `| undefined` explícito) para no obligar a los fixtures de test existentes a
   * declararla: `mapFilaToProduct` la trata igual que null si no vino.
   */
  overlayFichaTecnica?: FichaTecnicaCrm | null;
  /** false = el admin pidió no exhibir la marca. null/ausente = sin overlay ⇒ se muestra. */
  overlayMostrarMarca?: boolean | null;
  /**
   * Atributos estructurados (`public.catalog_atributos`), el jsonb de `atributosFilaSql`. Sólo
   * viene cuando la consulta los pidió (flag + tabla disponible); ausente o null = sin datos.
   */
  atributos?: unknown;
  /**
   * Flag `variantes-selector`: la opción de la variante dentro de su modelo y el grupo al que
   * pertenece. Sólo vienen con `agrupar` (ver `columnasCatalogo`); con ambos, el producto lleva
   * `opcion` y su línea del carrito/pedido se llama "Modelo / Opción".
   */
  etiqueta?: string | null;
  grupoId?: string | null;
  /** 'simple' | 'padre' | 'variante': con `agrupar`, para quitar la opción del nombre del modelo. */
  tipo?: string | null;
  /**
   * Modalidad de venta sin stock asignada (`catalog_overlay.modalidad_sin_stock_id`, del overlay del
   * join: con variantes, la del ancla). Sólo viene con modalidades activas (ver `columnasCatalogo`).
   */
  overlayModalidadId?: string | null;
  /**
   * Con modalidades activas y un contexto con traslado (`ContextoDisponibilidad.traslado`): alguna
   * sucursal alcanzable tiene stock disponible. Entonces el producto sin stock NO pasa a pedido.
   */
  overlayCubreOtra?: boolean | null;
  /** Campañas de precios del CRM (0095), crudas: ver `campaniaParaExhibir`. Ausente = ninguna. */
  campaniasOnline?: unknown;
}

/**
 * Campos de precio con impuestos, mismos para espejo y ficha en vivo. Sin IVA
 * conocido quedan undefined y la exhibición muestra el precio como antes.
 */
function camposIva(
  precioNeto: number,
  iva: number | null,
): Pick<Product, "ivaPorcentaje" | "precioFinal"> {
  if (iva == null || !Number.isFinite(iva)) return {};
  return { ivaPorcentaje: iva, precioFinal: precioFinal(precioNeto, iva) };
}

export function mapFilaToProduct(
  fila: FilaCatalogo,
  idPriceList?: string,
  /** Ver `hostsDeMedios()`. Parámetro para testear sin tocar `process.env`. */
  hostsMedios: readonly string[] = hostsDeMedios(),
  /** Ver `basePublicaMedios()`. Parámetro para testear sin tocar `process.env`. */
  baseMedios: string | null = basePublicaMedios(),
  /** Medios con "$X con <Medio>" (ver `flagsPublicos().mediosPrecio`). Sin él, el producto de siempre. */
  mediosPrecio?: MediosPrecio,
  /** Modalidades de venta sin stock activas (`modalidadesActivas()`). Vacía = el producto de siempre. */
  modalidades: readonly VentaSinStock[] = [],
): Product {
  const qty = fila.stock != null ? Number(fila.stock) : null;
  const iva = fila.ivaPorcentaje != null ? Number(fila.ivaPorcentaje) : null;
  const stock = derivarStock(qty);
  const modalidad = modalidadPorId(modalidades, fila.overlayModalidadId);
  // Sin stock en las sucursales que cuentan pero otra alcanzable lo trae: se ve como hoy (traslado).
  const ventaSinStock = modalidad && !(stock === "out" && fila.overlayCubreOtra === true) ? modalidad : undefined;
  // Campaña activa: los precios efectivos son los de campaña (también "$X con <Medio>") y el normal
  // de la misma lista se tacha. La misma regla que el cobro (`resolverPrecioVigente`).
  const enCampania = campaniaParaExhibir(mapPrecios(fila.prices), fila.campaniasOnline, mediosPrecio, idPriceList, iva);
  const precios = enCampania ? enCampania.precios : mapPrecios(fila.prices);
  const price = precioDeLista(precios, idPriceList);
  const atributosEstructurados = leerAtributosEstructurados(fila.atributos);
  const especificaciones = caracteristicasDe(atributosEstructurados);
  return {
    id: fila.alegraId,
    // La marca sale del customField de Alegra; si no está cargado, cae al
    // nombre de la categoría (mismo criterio que la ficha en vivo).
    // `mostrar_marca = false` en el overlay la apaga del todo (sin fallback a la categoría).
    brand: fila.overlayMostrarMarca === false ? "" : fila.brand || fila.categoryName || "",
    name: nombreExhibido(fila),
    price,
    ...camposIva(price, iva),
    ...armarPreciosMedios(precios, iva, mediosPrecio),
    ...(enCampania
      ? {
          oldPrice: precioFinal(enCampania.normal, iva) ?? enCampania.normal,
          // Lo que queda a precio de campaña nunca supera el stock disponible (no se inflan unidades).
          campania:
            enCampania.campania.quedan != null && qty != null
              ? { ...enCampania.campania, quedan: Math.max(0, Math.min(enCampania.campania.quedan, qty)) }
              : enCampania.campania,
        }
      : {}),
    stock,
    stockQty: qty ?? undefined,
    // `reference` de Alegra; si falta, `name`, que en esta cuenta ES el
    // código (y es con lo que el CRM elige destacados, ver destacados.ts).
    sku: fila.code || fila.name || undefined,
    // Si es el mismo texto que `name` (pasa sobre todo cuando `nombreExhibido`
    // tomó la descripción de Alegra como nombre), no hay descripción que
    // mostrar: repetiría el título.
    description: descripcionExhibida(fila),
    category: fila.categoryName || undefined,
    categoriaPropiaId: fila.overlayCategoriaId ?? undefined,
    images: fotosPermitidas(urlsDeFotos(fila.overlayFotos, baseMedios), hostsMedios),
    fichaTecnicaUrl: urlDeFicha(fila.overlayFichaTecnica, baseMedios),
    ...(atributosEstructurados ? { atributosEstructurados } : {}),
    ...(especificaciones.length ? { especificaciones } : {}),
    ...(fila.grupoId && fila.etiqueta?.trim() ? { opcion: fila.etiqueta.trim() } : {}),
    ...(ventaSinStock ? { ventaSinStock } : {}),
    // oldPrice / discount / badge → capa de marketing del shop, no de Alegra.
  };
}

/**
 * Límite de unidades de las campañas de precios: con campañas activas, lo que queda de cada regla con
 * límite de estas filas (una lectura de los pedidos), para que la ficha diga cuántas quedan y una
 * regla agotada vuelva sola al precio normal. Corre adentro de las funciones cacheadas: crear o
 * cancelar un pedido vence el tag del catálogo (`marcarStockCambiado`).
 */
async function conQuedanCampania(
  filas: readonly { campaniasOnline?: unknown }[],
  medios: MediosPrecio | undefined,
): Promise<MediosPrecio | undefined> {
  const activas = medios?.campanias;
  if (!medios || !activas?.length) return medios;
  const quedan = await quedanParaEntradas(
    getDb(),
    filas.map((f) => mapCampanias(f.campaniasOnline)),
    new Set(activas.map((c) => c.id)),
  );
  return quedan.size ? { ...medios, quedanCampania: Object.fromEntries(quedan) } : medios;
}

/** Mismo criterio que `urlsDeFotos`: la key se guarda en el CRM, la url se compone al leer. */
function urlDeFicha(ficha: FichaTecnicaCrm | null | undefined, base: string | null): string | undefined {
  if (!ficha || !base) return undefined;
  return `${base}/${ficha.key}`;
}

/**
 * `productos/{tenant}/{alegraId}/{uuid}` — lo que comparten las variantes
 * (320/800/1600) de una misma foto. Mismo criterio que `prefijoDe` en
 * apps/admin/src/components/admin/catalogo/FotosProducto.tsx.
 */
function prefijoDeFoto(key: string): string {
  return key.replace(/-\d+\.webp$/, "");
}

/**
 * El admin guarda las 3 variantes de cada foto como filas separadas; acá se
 * agrupan por foto lógica (mismo prefijo), preservando el orden de la
 * primera aparición, y se elige la variante más grande del grupo: es la que
 * mejor se ve en el detalle, y `next/image` la redimensiona solo para las
 * miniaturas y la card, así que no hace falta cargar las tres.
 */
function agruparFotos(fotos: FotoCrm[]): FotoCrm[] {
  const orden: string[] = [];
  const porPrefijo = new Map<string, FotoCrm[]>();
  for (const f of fotos) {
    const p = prefijoDeFoto(f.key);
    if (!porPrefijo.has(p)) {
      porPrefijo.set(p, []);
      orden.push(p);
    }
    porPrefijo.get(p)?.push(f);
  }
  return orden.map((p) => {
    const variantes = porPrefijo.get(p) ?? [];
    return [...variantes].sort((a, b) => b.w - a.w)[0];
  });
}

/**
 * El CRM guarda la key del objeto en R2 y la URL se compone al leer, con la
 * misma base pública que usa el CRM. Sin base configurada no hay fotos.
 */
function urlsDeFotos(fotos: FotoCrm[] | null, base: string | null) {
  if (!fotos?.length || !base) return undefined;
  return agruparFotos(fotos).map((f) => ({
    url: `${base}/${f.key}`,
    w: f.w,
    ...(f.alt !== undefined ? { alt: f.alt } : {}),
  }));
}


/**
 * Sólo productos publicados en el CRM, detrás del flag
 * `catalogo-solo-visibles` (Vercel Flags, apagado por defecto). Fail-closed:
 * sin fila de overlay el left join deja `visible` en NULL y el producto queda
 * afuera, así que con el flag prendido y sin curaduría la tienda queda vacía.
 *
 * El valor del flag lo pasa quien llama (`flagsPublicos()`, por request): esta
 * capa no evalúa flags, así se puede leer desde un scope cacheado y el valor
 * queda en la clave de la caché (ver src/lib/catalogo-publico.ts).
 */
function soloVisiblesSql(soloVisibles: boolean) {
  return soloVisibles ? eq(crmOverlay.visible, true) : undefined;
}

/**
 * Columnas del join, en un solo lugar para no repetirlas entre queries. El
 * stock, menos lo reservado (exige `.leftJoin(...joinStock(disp))`).
 */
const COLUMNAS_CATALOGO_BASE = {
  alegraId: crmCatalogo.alegraId,
  name: crmCatalogo.name,
  code: crmCatalogo.code,
  description: crmCatalogo.description,
  brand: crmCatalogo.brand,
  prices: preciosSql,
  stock: stockSql,
  ivaPorcentaje: crmCatalogo.ivaPorcentaje,
  categoryName: crmCategoriasAlegra.name,
  overlayNombre: crmOverlay.nombre,
  overlayDescripcion: crmOverlay.descripcion,
  overlayFotos: crmOverlay.fotos,
  overlayFichaTecnica: crmOverlay.fichaTecnica,
  overlayCategoriaId: crmOverlay.categoriaId,
  overlayMostrarMarca: crmOverlay.mostrarMarca,
};

/**
 * Atributos estructurados del producto de la fila (`public.catalog_atributos`, migración 0049 del
 * CRM) como UN jsonb `{clave: {n: valor_num, t: valor_texto}}`, NULL si no tiene ninguno.
 * Subconsulta correlacionada por la PK (tenant, producto): una lectura de índice por fila. Con el
 * tenant en el WHERE, como toda lectura de `public`.
 *
 * Sólo se arma cuando quien llama ya sabe que la tabla existe y se puede leer
 * (`atributosEstructuradosDisponibles`): nombrarla sin la migración rompería la consulta entera.
 */
const atributosFilaSql = () =>
  sql`(select jsonb_object_agg(${crmAtributos.clave}, jsonb_build_object('n', ${crmAtributos.valorNum}, 't', ${crmAtributos.valorTexto}))
    from ${crmAtributos}
    where ${crmAtributos.tenantId} = ${shopTenantId()} and ${crmAtributos.alegraId} = ${crmCatalogo.alegraId})`;

/**
 * Las columnas del catálogo. Con `disp` (flag `disponibilidad-sucursal`), el stock es el de las
 * sucursales del contexto menos su reserva (`stockSucursalSql`); sin él, el de siempre. Con
 * `estructurados`, además los atributos de `catalog_atributos` (ver `atributosFilaSql`).
 */
const columnasCatalogo = (
  disp?: ContextoDisponibilidad,
  estructurados = false,
  agrupar = false,
  /** Modalidades de venta sin stock activas: sólo con alguna se nombra la columna (lectura tolerante). */
  modalidades: readonly VentaSinStock[] = [],
) => {
  const base = disp ? { ...COLUMNAS_CATALOGO_BASE, stock: stockSucursalSql(disp) } : COLUMNAS_CATALOGO_BASE;
  const conAtributos = estructurados ? { ...base, atributos: sql<unknown>`${atributosFilaSql()}` } : base;
  // Con el flag `variantes-selector`: la opción de la variante, para nombrar la línea "Modelo / Opción".
  const conVariantes = agrupar
    ? { ...conAtributos, etiqueta: crmCatalogo.etiqueta, grupoId: crmCatalogo.grupoId, tipo: crmCatalogo.tipo }
    : conAtributos;
  const traslado = modalidades.length ? conTraslado(disp) : undefined;
  const conModalidad = modalidades.length
    ? {
        ...conVariantes,
        overlayModalidadId: crmOverlay.modalidadSinStockId,
        ...(traslado ? { overlayCubreOtra: cubreOtraSql(traslado) } : {}),
      }
    : conVariantes;
  // Campañas de precios (CRM 0095), siempre AL FINAL: una fila sin la columna (fixtures posicionales
  // de los tests) queda sin campañas, que es el precio de siempre.
  return { ...conModalidad, campaniasOnline: crmCatalogo.campaniasOnline };
};

/**
 * Filas de `catalog_atributos` del producto de la fila con una clave (la PK entera: una búsqueda
 * de índice). `extra` agrega condiciones sobre `valor_num`/`valor_texto`.
 */
const filaAtributoSql = (clave: string, extra?: SQL) =>
  sql`select 1 from ${crmAtributos}
    where ${crmAtributos.tenantId} = ${shopTenantId()} and ${crmAtributos.alegraId} = ${crmCatalogo.alegraId}
      and ${crmAtributos.clave} = ${clave}${extra ? sql` and ${extra}` : sql``}`;

/** `EXISTS` de un valor estructurado que cumple el criterio (una por atributo del WHERE). */
const existeAtributoSql = (c: CriterioEstructurado) =>
  sql`exists (${filaAtributoSql(c.clave, criterioSql(c, sql`${crmAtributos.valorNum}`, sql`${crmAtributos.valorTexto}`))})`;

/** `EXISTS` de una fila de la clave con dato que NO cumple el criterio (las medidas "sin contradicción"). */
const contradiceAtributoSql = (c: CriterioEstructurado) =>
  sql`exists (${filaAtributoSql(c.clave, contradiccionSql(c, sql`${crmAtributos.valorNum}`, sql`${crmAtributos.valorTexto}`))})`;

/** `EXISTS` de una fila de la clave, con cualquier valor (cobertura). */
const tieneAtributoSql = (clave: ClaveEstructurada) => sql`exists (${filaAtributoSql(clave)})`;

type FiltrosDeAtributos = Pick<FiltrosCatalogo, "atributosEstructurados" | "medidasPositivas" | "categorias" | "texto">;

/**
 * Modo de las medidas (ids dinámicos de atributo) como filtro: positivo si la consulta no tiene
 * universo acotado ("20a", `?atr=corriente_a:20` a mano), sin contradicción si lo tiene. Lo fuerza
 * `medidasPositivas`. Los ids del diccionario no dependen de esto.
 */
const medidasPositivasDe = (filtros: FiltrosDeAtributos): boolean =>
  filtros.medidasPositivas ?? !universoAcotado({ categorias: filtros.categorias, busqueda: filtros.texto?.q, planBusqueda: filtros.texto?.plan });

/** Contexto de las condiciones de atributos: el texto buscable y, si se pueden leer, los estructurados. */
const contextoAtributos = (filtros: FiltrosDeAtributos): ContextoAtributos => ({
  texto: textoBuscableSql(),
  ...(filtros.atributosEstructurados
    ? { existe: existeAtributoSql, contradice: contradiceAtributoSql, tiene: tieneAtributoSql }
    : {}),
  medidaPositiva: medidasPositivasDe(filtros),
});

/** Sólo productos con dato de TODAS esas claves (la cobertura de una clave en un universo). Sin estructurados, no filtra. */
const filtroConClavesSql = (filtros: FiltrosCatalogo): SQL | undefined => {
  if (!filtros.conClaves?.length) return undefined;
  const ctx = contextoAtributos(filtros);
  return and(...filtros.conClaves.map((clave) => tieneClaveSql(ctx, clave)));
};

/**
 * Contexto del filtro estricto `?car=` y de las facetas por tipo (catalogo-facetas-sql.ts): el `EXISTS`
 * de la fila de una clave del producto de la fila, contra la PK de `catalog_atributos`.
 */
const contextoCar: ContextoCar = {
  num: sql`${crmAtributos.valorNum}`,
  texto: sql`${crmAtributos.valorTexto}`,
  existe: (clave, condicion) => sql`exists (${filaAtributoSql(clave, condicion)})`,
};

/** Facetas por tipo y filtro `car` (ver `FiltrosCatalogo.facetasPorTipo`). */
const conFacetasPorTipo = (filtros: Pick<FiltrosCatalogo, "facetasPorTipo">): boolean => Boolean(filtros.facetasPorTipo);

/** Filtro de potencia en UN `EXISTS` (los dos extremos sobre la misma fila). */
const filtroPotenciaSql = (min?: number, max?: number) =>
  min == null && max == null
    ? undefined
    : sql`exists (${filaAtributoSql(
        "potencia_w",
        and(
          min != null ? sql`${crmAtributos.valorNum} >= ${min}` : undefined,
          max != null ? sql`${crmAtributos.valorNum} <= ${max}` : undefined,
        ),
      )})`;

/** Potencia (W) estructurada del producto de la fila, numeric o NULL (una búsqueda por PK). */
const potenciaSql = () =>
  sql`(select ${crmAtributos.valorNum} from ${crmAtributos}
    where ${crmAtributos.tenantId} = ${shopTenantId()} and ${crmAtributos.alegraId} = ${crmCatalogo.alegraId}
      and ${crmAtributos.clave} = 'potencia_w')`;

/** Con `disp`, sólo productos que alguna sucursal activa sirve (ver `visibleEnSucursalSql`). */
const visibleEnZonaSql = (disp?: ContextoDisponibilidad) => (disp ? visibleEnSucursalSql(disp) : undefined);

/**
 * Minúsculas y sin tildes en SQL. Las tildes importan: el catálogo dice
 * "Termomagnético" y el cliente escribe "termomagnetico". Del lado del texto
 * buscado lo mismo lo hace `terminosBusqueda` (catalogo-busqueda.ts).
 *
 * La función se llama CALIFICADA con su esquema: vive en `shop`, y que se
 * resuelva sin calificar dependería del `search_path` de la conexión, que por
 * el pooler no está garantizado. Lo mismo `public.word_similarity` (pg_trgm).
 * Las vistas del CRM las califica drizzle desde `crm.ts`, y las columnas
 * quedan calificadas con el nombre de la vista.
 */
const sinTildes = (expr: unknown) => sql`"shop".immutable_unaccent(lower(${expr}))`;

/**
 * Todo el texto por el que se puede encontrar un producto, en una cadena:
 * nombre curado (overlay), nombre, código, descripción, marca y categoría de
 * Alegra. En esta cuenta de Alegra el nombre comercial vive en `description`,
 * así que sin ella la búsqueda no encontraría casi nada. `concat_ws` saltea
 * los null. Exige los joins al overlay y a las categorías (los tienen todas
 * las consultas del catálogo).
 */
const textoBuscableSql = () =>
  sinTildes(
    sql`concat_ws(' ', ${crmOverlay.nombre}, ${crmCatalogo.name}, ${crmCatalogo.code}, ${crmCatalogo.description}, ${crmCatalogo.brand}, ${crmCategoriasAlegra.name})`,
  );

/** `expr` contiene el término o su singular (ver `formasTermino`). */
const contiene = (expr: unknown, termino: string) => {
  const formas = formasTermino(termino).map((f) => sql`${expr} LIKE ${patronLike(f)}`);
  return formas.length === 1 ? formas[0] : sql`(${sql.join(formas, sql` or `)})`;
};

/**
 * Términos a los que se les aplica el parecido por trigramas: sólo palabras
 * de 4 o más. Un "9w" o "e27" mal tipeado no debería traer coincidencias
 * difusas (los trigramas de algo tan corto se parecen a cualquier cosa).
 */
const admiteParecido = (termino: string) => termino.length >= 4;

/**
 * Parecido mínimo (pg_trgm `word_similarity`, 0..1) para que un término
 * cuente en la búsqueda tolerante. Medido contra el catálogo real: "lampra"
 * → "lámpara" da 0.57 y "termomagentico" → "termomagnético" 0.58, así que un
 * umbral más alto los pierde. El costo es algo de ruido ("foco" → "focal"
 * da 0.60): lo resuelven los sinónimos, no el umbral.
 */
const UMBRAL_PARECIDO = 0.5;

/**
 * Condición de búsqueda por texto: TODOS los términos tienen que aparecer en
 * algún lado del producto, en cualquier orden ("lampara led" encuentra
 * "Lámpara 9W LED"). Sin términos útiles, no filtra.
 *
 * `tolerante` suma, por término, el parecido por trigramas: es el segundo
 * intento cuando la búsqueda exacta no trajo nada (errores de tipeo, ver la
 * page del catálogo y `/api/shop/catalogo`). Necesita `pg_trgm`
 * (drizzle/0022).
 */
function coincideTexto(q: string, tolerante = false) {
  const terminos = terminosBusqueda(q);
  if (!terminos.length) return undefined;
  const texto = textoBuscableSql();
  return and(
    ...terminos.map((t) =>
      tolerante && admiteParecido(t)
        ? or(
            contiene(texto, t),
            sql`public.word_similarity(${raizPlural(t)}, ${texto}) >= ${UMBRAL_PARECIDO}`,
          )
        : contiene(texto, t),
    ),
  );
}

/**
 * Parecido mínimo (pg_trgm `word_similarity`) entre el código buscado, sin separadores, y el código
 * del producto, también sin separadores: sólo en el segundo intento de la etapa de código
 * (`texto.tolerante` + `texto.codigo`) y sólo con 4 caracteres o más. Valor inicial: se calibra con
 * el corte `tipo=codigo` del banco.
 */
const UMBRAL_CODIGO = 0.6;

/** El código del producto sin separadores (minúsculas, sin tildes, sólo letras y dígitos). */
const codigoSinSeparadoresSql = () => sql`regexp_replace(${sinTildes(crmCatalogo.code)}, '[^a-z0-9]', '', 'g')`;

/**
 * Etapa de código: `qn` (el código buscado normalizado) está contenido en el código del producto
 * sin separadores (`DL18W` encuentra `DL-18W`); con `tolerante` y 4 caracteres o más, también el
 * que se parece por trigramas. Se une con la clásica de términos (superconjunto de la AND).
 */
function condicionCodigo(qn: string, tolerante: boolean) {
  const codigo = codigoSinSeparadoresSql();
  const partes = [sql`${codigo} LIKE ${patronLike(qn)}`];
  if (tolerante && qn.length >= 4) partes.push(sql`public.word_similarity(${qn}, ${codigo}) >= ${UMBRAL_CODIGO}`);
  return partes;
}

/**
 * Condición de texto sin plan: la clásica de términos (`coincideTexto`) y, con `codigo`, también
 * el código normalizado sin separadores. Un código de menos de 3 caracteres no activa la etapa.
 */
function textoClasico(texto: TextoBusqueda) {
  const clasica = coincideTexto(texto.q, texto.tolerante);
  const qn = texto.codigo ? normalizarCodigo(texto.q) : "";
  if (!qn) return clasica;
  const partes = condicionCodigo(qn, !!texto.tolerante);
  if (clasica) partes.push(clasica);
  return or(...partes);
}

/** Términos del plan a los que el segundo intento les suma el parecido: los que recuperan y tienen 4 letras o más. */
const terminosParecidos = (plan: CriterioPlan) => terminosQueRecuperan(plan).filter(admiteParecido);

/**
 * Tolerante CON plan: lo que recupera el plan o, por cada término que recupera, su parecido por
 * trigramas con el texto buscable (un typo no hace perder el resto del plan). Los duros no pasan
 * por acá: siguen siendo filtros de `condicionesDe`.
 */
function recuperarTolerante(plan: CriterioPlan, recuperar: SQL | undefined, p: PiezasBusqueda) {
  const parecidos = terminosParecidos(plan).map(
    (t) => sql`public.word_similarity(${raizPlural(t)}, ${p.texto}) >= ${UMBRAL_PARECIDO}`,
  );
  const partes = [...(recuperar ? [recuperar] : []), ...parecidos];
  if (!partes.length) return undefined;
  return partes.length === 1 ? partes[0] : or(...partes);
}

/**
 * Puntaje de relevancia para el orden `relevancia`. Por término, pesa DÓNDE
 * aparece: en el nombre exhibido 4, en el código 3, en la marca o categoría
 * 2, en otro lado (descripción) 1. Encima: código exacto +20 (quien pega un
 * código quiere ESE producto) y nombre que empieza con el primer término +2.
 * En la búsqueda tolerante se suma el parecido de cada término con el nombre.
 */
function relevanciaSql(q: string, tolerante: boolean, codigo = "") {
  const terminos = terminosBusqueda(q);
  const nombre = sinTildes(nombreExhibidoSql);
  const codigoCol = sinTildes(crmCatalogo.code);
  const marcaCategoria = sinTildes(sql`concat_ws(' ', ${marcaSql}, ${crmCategoriasAlegra.name})`);
  const partes = terminos.map(
    (t) =>
      sql`(case when ${contiene(nombre, t)} then 4 when ${contiene(codigoCol, t)} then 3 when ${contiene(marcaCategoria, t)} then 2 else 1 end)`,
  );
  partes.push(sql`(case when ${codigoCol} = ${terminos.join(" ")} then 20 else 0 end)`);
  // Etapa de código: el código sin separadores exacto arriba de todo, y después el que empieza con él.
  if (codigo) {
    const sinSeparadores = codigoSinSeparadoresSql();
    partes.push(sql`(case when ${sinSeparadores} = ${codigo} then 20 else 0 end)`);
    partes.push(sql`(case when ${sinSeparadores} LIKE ${patronPrefijo(codigo)} then 12 else 0 end)`);
  }
  // En la tolerante el primer término puede no ser prefijo exacto de nada
  // ("lamparita" no lo es de "lámpara"): alcanza con que el nombre empiece
  // con sus primeras 4 letras. Sin esto, "Dimmer para lámparas" le ganaba a
  // "Lámpara bulbo" por orden alfabético (los dos se parecen igual).
  const prefijo = tolerante ? raizPlural(terminos[0]).slice(0, 4) : raizPlural(terminos[0]);
  partes.push(sql`(case when ${nombre} LIKE ${patronPrefijo(prefijo)} then 2 else 0 end)`);
  if (tolerante) {
    for (const t of terminos.filter(admiteParecido)) {
      partes.push(sql`public.word_similarity(${raizPlural(t)}, ${nombre}) * 4`);
    }
  }
  return sql.join(partes, sql` + `);
}

/**
 * Trae el catálogo del tenant desde la vista del CRM. Solo productos activos.
 *
 * Sin `limit` devuelve el catálogo completo: es una sola query indexada, y las
 * facetas del catálogo solo son correctas si se calculan sobre todo el conjunto.
 * `idPriceList` aplica la lista de precios del cliente logueado si tiene una.
 */
export async function getCatalogo(opts: {
  /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
  soloVisibles: boolean;
  /**
   * Flag `variantes-selector` (change `variantes-de-producto`): un representante por modelo y overlay
   * del ancla del grupo (ver `joinOverlay` y `enListado`). Ausente = apagado: como siempre.
   */
  agrupar?: boolean;
  idPriceList?: string;
  /** "$X con <Medio>" (ver `mapFilaToProduct`). */
  mediosPrecio?: MediosPrecio;
  limit?: number;
  offset?: number;
  /**
   * Contexto de disponibilidad por sucursal (flag `disponibilidad-sucursal`): stock por sucursal y
   * productos ocultos por sucursal. Ausente = stock único, como siempre.
   */
  disp?: ContextoDisponibilidad;
  /**
   * Sumar los atributos estructurados de cada producto (`catalog_atributos`). Sólo con la tabla
   * disponible (`atributosEstructuradosDisponibles`).
   */
  atributosEstructurados?: boolean;
}): Promise<Product[]> {
  const modalidades = await modalidadesActivas();
  let query = getDb()
    .select(columnasCatalogo(opts.disp, opts.atributosEstructurados, opts.agrupar ?? false, modalidades))
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(opts.agrupar ?? false))
    .leftJoin(...joinStock(opts.disp))
    .where(
      and(
        enTenantCatalogo(),
        activoSql,
        enListado(opts.agrupar ?? false),
        conPrecioSql,
        soloVisiblesSql(opts.soloVisibles),
        visibleEnZonaSql(opts.disp),
      )
    )
    .orderBy(asc(crmCatalogo.name))
    .$dynamic();

  if (opts.limit != null) query = query.limit(opts.limit);
  if (opts.offset != null) query = query.offset(opts.offset);

  const filas = await query;
  const medios = await conQuedanCampania(filas, opts.mediosPrecio);
  return filas.map((f) => mapFilaToProduct(f, opts.idPriceList, undefined, undefined, medios, modalidades));
}

/**
 * Productos de UNA categoría del admin, exacta (sin su subárbol), para los
 * relacionados de la ficha: en un velador a batería, más veladores a batería y
 * no todo "Iluminación". Solo con stock, en orden alfabético. null si la
 * categoría no existe o está inactiva.
 */
export async function getCategoriaExacta(opts: {
  categoriaId: string;
  limit: number;
  soloVisibles: boolean;
  /**
   * Flag `variantes-selector` (change `variantes-de-producto`): un representante por modelo y overlay
   * del ancla del grupo (ver `joinOverlay` y `enListado`). Ausente = apagado: como siempre.
   */
  agrupar?: boolean;
  /**
   * Contexto de disponibilidad por sucursal (flag `disponibilidad-sucursal`): stock por sucursal y
   * productos ocultos por sucursal. Ausente = stock único, como siempre.
   */
  disp?: ContextoDisponibilidad;
  /** "$X con <Medio>" (ver `mapFilaToProduct`). */
  mediosPrecio?: MediosPrecio;
}): Promise<{ nombre: string; productos: Product[] } | null> {
  const [categoria] = await getDb()
    .select({ nombre: crmCategorias.nombre })
    .from(crmCategorias)
    .where(
      and(
        eq(crmCategorias.id, opts.categoriaId),
        eq(crmCategorias.tenantId, shopTenantId()),
        eq(crmCategorias.activa, true),
      ),
    )
    .limit(1);
  if (!categoria) return null;

  const modalidades = await modalidadesActivas();
  const filas = await getDb()
    .select(columnasCatalogo(opts.disp, false, opts.agrupar ?? false, modalidades))
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(opts.agrupar ?? false))
    .leftJoin(...joinStock(opts.disp))
    .where(
      and(
        enTenantCatalogo(),
        activoSql,
        enListado(opts.agrupar ?? false),
        conPrecioSql,
        soloVisiblesSql(opts.soloVisibles),
        visibleEnZonaSql(opts.disp),
        eq(crmOverlay.categoriaId, opts.categoriaId),
        conStock(opts.disp, modalidades),
      ),
    )
    .orderBy(asc(crmCatalogo.name))
    .limit(opts.limit);

  const medios = await conQuedanCampania(filas, opts.mediosPrecio);
  return {
    nombre: categoria.nombre,
    productos: filas.map((f) => mapFilaToProduct(f, undefined, undefined, undefined, medios, modalidades)),
  };
}

/**
 * Productos del catálogo por id de Alegra, para las líneas de pedido de Mi
 * cuenta (y favoritos). Una sola consulta por llamada: quien tiene N líneas
 * junta los ids y llama una vez, nunca una por línea.
 *
 * Sin filtro de estado por default: un pedido viejo sigue mostrando el nombre
 * real de un ítem que después se despublicó. `soloActivos` aplica
 * `activo` y, con `soloVisibles` (el flag `catalogo-solo-visibles`), también
 * `visible` (mismo criterio que la lista pública). `soloVisibles` sin
 * `soloActivos` no filtra nada.
 *
 * Sin `orderBy` (el orden lo decide quien llama: pedidos por línea, favoritos
 * por fecha) y sin `limit` (los ids ya vienen acotados por quien llama). Un id
 * que la vista no tiene (para este tenant) simplemente no aparece en el `Map`.
 */
export async function getProductosPorIds(
  alegraIds: readonly string[],
  opts?: {
    idPriceList?: string;
    soloActivos?: boolean;
    soloVisibles?: boolean;
    /**
     * Flag `variantes-selector`: lee el overlay del ancla del grupo (nombre, fotos, visibilidad). NO
     * filtra por representante: la variante pedida (carrito, favoritos, pedido) sale siempre.
     */
    agrupar?: boolean;
    /** Con `soloActivos`, también excluye lo oculto en todas las sucursales que sirven al visitante. */
    disp?: ContextoDisponibilidad;
    /** Sumar los atributos estructurados (sólo con la tabla disponible). */
    atributosEstructurados?: boolean;
    /** "$X con <Medio>" (ver `mapFilaToProduct`). */
    mediosPrecio?: MediosPrecio;
  },
): Promise<Map<string, Product>> {
  if (alegraIds.length === 0) return new Map();

  const modalidades = await modalidadesActivas();
  const filas = await getDb()
    .select(columnasCatalogo(opts?.disp, opts?.atributosEstructurados, opts?.agrupar ?? false, modalidades))
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(opts?.agrupar ?? false))
    .leftJoin(...joinStock(opts?.disp))
    .where(
      and(
        enTenantCatalogo(),
        inArray(crmCatalogo.alegraId, [...alegraIds]),
        opts?.soloActivos ? activoSql : undefined,
        opts?.soloActivos ? soloVisiblesSql(opts.soloVisibles ?? false) : undefined,
        opts?.soloActivos ? visibleEnZonaSql(opts.disp) : undefined,
      ),
    );

  // Con el flag: la foto propia de cada variante, si la tiene (si no, la del modelo).
  const propias = new Map<string, FotoCrm[]>();
  if (opts?.agrupar && filas.length) {
    const fotos = await getDb()
      .select({ alegraId: crmOverlay.alegraId, fotos: crmOverlay.fotos })
      .from(crmOverlay)
      .where(and(eq(crmOverlay.tenantId, shopTenantId()), inArray(crmOverlay.alegraId, [...alegraIds])));
    for (const f of fotos) if (f.fotos?.length) propias.set(f.alegraId, f.fotos);
  }

  const medios = await conQuedanCampania(filas, opts?.mediosPrecio);
  return new Map(
    filas.map((f) => {
      const fotosPropias = propias.get(f.alegraId);
      const fila = f;
      return [
        f.alegraId,
        mapFilaToProduct(
          { ...fila, overlayFotos: fotosPropias?.length ? fotosPropias : fila.overlayFotos },
          opts?.idPriceList,
          undefined,
          undefined,
          medios,
          modalidades,
        ),
      ];
    }),
  );
}

/**
 * Flag `variantes-selector`: para cada id que es el MODELO de un grupo (el padre, que no se vende), el
 * id de su representante activo. Un favorito o un link viejo con el id del modelo se resuelve así a
 * una opción comprable. Los ids que no son un modelo, o cuyo modelo no tiene opciones activas, no
 * aparecen en el resultado. Una consulta, con el tenant en el WHERE.
 */
export async function representantesDePadres(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  // Sólo los que son un padre de verdad: el ancla de un grupo manual es un producto vendible y no se reemplaza.
  const padres = db
    .select({ id: crmCatalogo.alegraId })
    .from(crmCatalogo)
    .where(and(enTenantCatalogo(), eq(crmCatalogo.tipo, "padre"), inArray(crmCatalogo.alegraId, [...ids])));
  const filas = await db
    .select({ grupoId: crmCatalogo.grupoId, alegraId: crmCatalogo.alegraId })
    .from(crmCatalogo)
    .where(and(enTenantCatalogo(), activoSql, enListado(true), inArray(crmCatalogo.grupoId, padres)));
  const mapa = new Map<string, string>();
  for (const f of filas) if (f.grupoId && !mapa.has(f.grupoId)) mapa.set(f.grupoId, f.alegraId);
  return mapa;
}

/**
 * Productos del catálogo por código, para los destacados que el admin elige a
 * mano en la home. Compara contra `code` o `name` de Alegra sin distinguir
 * mayúsculas (el código vive en cualquiera de los dos según el ítem, ver `sku`
 * en `mapFilaToProduct`). Mismos filtros que la lista pública: un producto que
 * el visitante no vería no sale. Sin orden: lo decide quien llama.
 */
export async function getProductosPorSkus(
  skus: readonly string[],
  opts: {
    soloVisibles: boolean;
    /**
     * Flag `variantes-selector` (change `variantes-de-producto`): un representante por modelo y overlay
     * del ancla del grupo (ver `joinOverlay` y `enListado`). Ausente = apagado: como siempre.
     */
    agrupar?: boolean;
    disp?: ContextoDisponibilidad;
    /** "$X con <Medio>" (ver `mapFilaToProduct`). */
    mediosPrecio?: MediosPrecio;
  },
): Promise<Product[]> {
  const codigos = [...new Set(skus.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (codigos.length === 0) return [];

  const db = getDb();
  const coincideCodigo = or(
    inArray(sql`upper(btrim(${crmCatalogo.code}))`, codigos),
    inArray(sql`upper(btrim(${crmCatalogo.name}))`, codigos),
  );
  const gruposDeCodigos = db
    .select({ g: sql<string>`${crmCatalogo.grupoId}` })
    .from(crmCatalogo)
    .where(and(enTenantCatalogo(), coincideCodigo));
  const modalidades = await modalidadesActivas();
  const filas = await db
    .select(columnasCatalogo(opts.disp, false, opts.agrupar ?? false, modalidades))
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(opts.agrupar ?? false))
    .leftJoin(...joinStock(opts.disp))
    .where(
      and(
        enTenantCatalogo(),
        activoSql,
        enListado(opts.agrupar ?? false),
        conPrecioSql,
        soloVisiblesSql(opts.soloVisibles),
        visibleEnZonaSql(opts.disp),
        or(
          coincideCodigo,
          // Con el flag, el código de CUALQUIER variante trae a su modelo (una card por modelo, con su
          // representante), no sólo el código de la que es representante.
          opts.agrupar ? inArray(crmCatalogo.grupoId, gruposDeCodigos) : undefined,
        ),
      ),
    );

  const medios = await conQuedanCampania(filas, opts.mediosPrecio);
  const productos = filas.map((f) => mapFilaToProduct(f, undefined, undefined, undefined, medios, modalidades));
  if (!opts.agrupar) return productos;
  // Los códigos pedidos que cayeron en el grupo de cada card (para ubicarla en el lugar elegido).
  const grupoDe = new Map(filas.map((f) => [f.alegraId, (f as { grupoId?: string | null }).grupoId ?? null]));
  const codigosPorGrupo = new Map<string, string[]>();
  const grupos = [...new Set([...grupoDe.values()].filter((g): g is string => !!g))];
  if (grupos.length) {
    const elegidas = await db
      .select({ grupoId: crmCatalogo.grupoId, code: crmCatalogo.code, name: crmCatalogo.name })
      .from(crmCatalogo)
      .where(and(enTenantCatalogo(), inArray(crmCatalogo.grupoId, grupos), coincideCodigo));
    for (const e of elegidas) {
      if (!e.grupoId) continue;
      const lista = codigosPorGrupo.get(e.grupoId) ?? [];
      for (const c of [e.code, e.name]) if (c && codigos.includes(c.trim().toUpperCase())) lista.push(c.trim().toUpperCase());
      codigosPorGrupo.set(e.grupoId, lista);
    }
  }
  return conResumenDeVariantes(
    productos.map((p) => {
      const g = grupoDe.get(p.id);
      const cods = g ? codigosPorGrupo.get(g) : undefined;
      return cods?.length ? { ...p, codigosElegidos: [...new Set(cods)] } : p;
    }),
    undefined,
    opts.mediosPrecio,
  );
}

// ---------------------------------------------------------------------------
// Variantes (flag `variantes-selector`, change `variantes-de-producto`)
// ---------------------------------------------------------------------------

/**
 * Precio exhibido (con IVA si se conoce) de una fila de la vista: el mismo que muestra la card del
 * producto (`mapFilaToProduct`), para comparar variantes entre sí.
 */
export function precioExhibidoDe(
  prices: unknown,
  iva: string | null,
  idPriceList?: string,
  /** Campañas del CRM (0095) de la fila y las activas del request: "Desde" con el precio de campaña. */
  campaniasOnline?: unknown,
  mediosPrecio?: MediosPrecio,
): number {
  const base = mapPrecios(prices);
  const enCampania = campaniaParaExhibir(base, campaniasOnline, mediosPrecio, idPriceList);
  const neto = precioDeLista(enCampania ? enCampania.precios : base, idPriceList);
  const ivaNum = iva != null ? Number(iva) : null;
  return camposIva(neto, ivaNum).precioFinal ?? neto;
}

/**
 * Sólo con el flag prendido. Para cada producto de la lista que pertenece a un grupo con al menos
 * 2 variantes activas con precio, suma `variantes` (cantidad de opciones y, si los precios difieren,
 * el menor: "Desde $X"). Los productos sueltos y los modelos de una sola opción quedan como estaban.
 *
 * Son dos lecturas por página (el grupo de cada producto y sus hermanas), ambas con el tenant en el
 * WHERE. Los precios son los públicos de la lista del visitante (los que ya tiene la card): el
 * precio de lista privada de una cuenta se superpone en el navegador, y la card no ofrece "Desde"
 * cuando eso pasa (ver `vistaCardVariantes`).
 */
export async function conResumenDeVariantes(
  productos: Product[],
  idPriceList?: string,
  /** Las campañas activas viajan acá (ver `MediosPrecio.campanias`): el "Desde" es el de campaña. */
  mediosPrecio?: MediosPrecio,
): Promise<Product[]> {
  if (productos.length === 0) return productos;
  const db = getDb();
  const grupos = await db
    .select({ alegraId: crmCatalogo.alegraId, grupoId: crmCatalogo.grupoId })
    .from(crmCatalogo)
    .where(
      and(
        enTenantCatalogo(),
        inArray(
          crmCatalogo.alegraId,
          productos.map((p) => p.id),
        ),
        sql`${crmCatalogo.grupoId} is not null`,
      ),
    );
  if (grupos.length === 0) return productos;
  const idsDeGrupo = [...new Set(grupos.map((g) => g.grupoId as string))];
  const hermanas = await db
    .select({
      grupoId: crmCatalogo.grupoId,
      alegraId: crmCatalogo.alegraId,
      etiqueta: crmCatalogo.etiqueta,
      prices: preciosSql,
      iva: crmCatalogo.ivaPorcentaje,
      campaniasOnline: crmCatalogo.campaniasOnline,
    })
    .from(crmCatalogo)
    .where(and(enTenantCatalogo(), inArray(crmCatalogo.grupoId, idsDeGrupo), activoSql, conPrecioSql));
  const preciosPorGrupo = new Map<string, number[]>();
  const opcionesPorGrupo = new Map<string, { id: string; etiqueta: string }[]>();
  for (const h of hermanas) {
    const lista = preciosPorGrupo.get(h.grupoId as string) ?? [];
    lista.push(precioExhibidoDe(h.prices, h.iva, idPriceList, h.campaniasOnline, mediosPrecio));
    preciosPorGrupo.set(h.grupoId as string, lista);
    const etiqueta = h.etiqueta?.trim();
    if (etiqueta) {
      const ops = opcionesPorGrupo.get(h.grupoId as string) ?? [];
      ops.push({ id: h.alegraId, etiqueta });
      opcionesPorGrupo.set(h.grupoId as string, ops);
    }
  }
  const grupoDe = new Map(grupos.map((g) => [g.alegraId, g.grupoId as string]));
  return productos.map((p) => {
    const g = grupoDe.get(p.id);
    const resumen = g
      ? resumirVariantes(
          preciosPorGrupo.get(g) ?? [],
          ordenarOpciones(opcionesPorGrupo.get(g) ?? []).map((o) => o.etiqueta),
        )
      : undefined;
    return resumen ? { ...p, variantes: resumen } : p;
  });
}

/**
 * Las opciones del selector de la ficha: todas las variantes activas, con precio y visibles del
 * grupo (la fila de la vista con `grupo_id = X`; el padre no está: nunca es `activo`). Cada una trae
 * su `Product` completo (precio, stock disponible, "con medio", cuotas) por el mismo camino que la
 * ficha de un producto suelto, con el overlay del ANCLA (nombre, descripción, ficha, fotos del
 * modelo). Las fotos de la opción son las propias de su overlay si las tiene; si no, las del modelo.
 */
export async function getVariantesDeGrupo(
  grupoId: string,
  opts: {
    soloVisibles: boolean;
    idPriceList?: string;
    disp?: ContextoDisponibilidad;
    atributosEstructurados?: boolean;
    mediosPrecio?: MediosPrecio;
  },
): Promise<(OpcionFicha & { esRepresentante: boolean })[]> {
  const propio = alias(crmOverlay, "overlay_propio");
  const modalidades = await modalidadesActivas();
  const { campaniasOnline, ...columnas } = columnasCatalogo(opts.disp, opts.atributosEstructurados, false, modalidades);
  const filas = await getDb()
    .select({
      ...columnas,
      etiqueta: crmCatalogo.etiqueta,
      tipo: crmCatalogo.tipo,
      esRepresentante: crmCatalogo.esRepresentante,
      fotosPropias: propio.fotos,
      campaniasOnline, // al final, como en `columnasCatalogo`
    })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(true))
    .leftJoin(propio, and(eq(propio.alegraId, crmCatalogo.alegraId), eq(propio.tenantId, shopTenantId())))
    .leftJoin(...joinStock(opts.disp))
    .where(
      and(
        enTenantCatalogo(),
        eq(crmCatalogo.grupoId, grupoId),
        activoSql,
        conPrecioSql,
        soloVisiblesSql(opts.soloVisibles),
        visibleEnZonaSql(opts.disp),
      ),
    );
  const medios = await conQuedanCampania(filas, opts.mediosPrecio);
  const opciones = filas.map((f) => {
    const { etiqueta, esRepresentante, fotosPropias, ...fila } = f; // `tipo` queda en `fila`
    // `grupoId` no se selecciona (es el del pedido): todas las opciones son del mismo grupo.
    const producto = mapFilaToProduct(
      { ...fila, etiqueta, grupoId, overlayFotos: fotosPropias?.length ? fotosPropias : fila.overlayFotos },
      opts.idPriceList,
      undefined,
      undefined,
      medios,
      modalidades,
    );
    return { id: fila.alegraId, etiqueta: etiqueta?.trim() || producto.name, producto, esRepresentante };
  });
  return ordenarOpciones(opciones);
}

/** Las opciones en orden natural de etiqueta ("5 m" antes que "10 m"), con el id como desempate estable. */
const COLLATOR_OPCIONES = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
function ordenarOpciones<T extends { id: string; etiqueta: string }>(opciones: T[]): T[] {
  return [...opciones].sort((a, b) => COLLATOR_OPCIONES.compare(a.etiqueta, b.etiqueta) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Catálogo paginado (filtros, orden y conteo en el servidor)
// ---------------------------------------------------------------------------

/** Cuántos productos entran en una página del catálogo. Múltiplo de la grilla (1/2/3 columnas). */
export const PRODUCTOS_POR_PAGINA = 24;

/**
 * El texto de una búsqueda, ya decidido por quien la pide (el motor, `busqueda-v2/motor.ts`): la
 * ÚNICA forma de pedirle texto al catálogo.
 */
export interface TextoBusqueda {
  /** La consulta (recortada). Puede ser "" si sólo hay plan. */
  q: string;
  /** Con plan: recupera por OR y ordena con el puntaje del plan; sin plan, AND de LIKE. */
  plan?: CriterioPlan;
  /** Suma el parecido por trigramas por término de 4 letras o más. */
  tolerante?: boolean;
  /**
   * Etapa de código: además de la clásica, coincide por el código normalizado sin separadores
   * (`DL18W` encuentra `DL-18W`) y lo ordena arriba. Con `tolerante`, suma el parecido por
   * trigramas sobre el código (4 caracteres o más). Un código de menos de 3 caracteres se ignora.
   */
  codigo?: boolean;
}

/** Filtros que aplica el servidor. Categorías y marcas son OR dentro del grupo. */
export interface FiltrosCatalogo {
  /**
   * El texto de la búsqueda (ver `TextoBusqueda`): la consulta, el plan de la búsqueda v2 (lo blando;
   * los duros viajan como siempre en `categorias` y `atributos`) y si es la etapa tolerante o de
   * código. Va en los MISMOS filtros de la página y de las facetas: así cuentan el mismo conjunto que
   * se ve.
   */
  texto?: TextoBusqueda;
  categorias?: string[];
  marcas?: string[];
  /**
   * Páginas de marca: valores CRUDOS de marca (`marcaPropiaSql`), sin el corte de
   * `mostrar_marca`. Ese flag decide si la card muestra la marca, no si el producto es de
   * la marca: con `marcas` un producto con la marca oculta quedaría fuera de su página.
   */
  marcasPropias?: string[];
  /**
   * Interno (no viaja en la URL): ids de las campañas de precios ACTIVAS en el request. Con ellas el
   * orden, el filtro y el rango por precio usan el precio de campaña (`precioVigenteSql`), el mismo
   * que muestra la card. Va en los filtros porque ya llegan a la página, al orden y a las facetas, y
   * son parte de la clave de sus cachés. Lo completa `getPaginaCatalogo` desde `mediosPrecio`.
   */
  precioCampanias?: string[];
  /**
   * Una línea de una página de marca: lo que está en alguna de estas categorías (con su
   * subárbol, como `categorias`) O tiene alguno de estos códigos (como `getProductosPorSkus`).
   * Las dos listas vacías no filtran.
   */
  linea?: { categorias: string[]; skus: string[] };
  /**
   * Ids del diccionario de atributos (catalogo-atributos.ts): AND entre
   * grupos, OR dentro del grupo, con `~*` sobre el texto buscable.
   */
  atributos?: string[];
  /**
   * Medidas (ids dinámicos `corriente_a:20` dentro de `atributos`): fuerza el modo del filtro,
   * `true` = positivo (sólo lo que cumple), `false` = sin contradicción. Ausente: se deriva del
   * universo de la consulta (`universoAcotado`). Lo usa el conteo de positivos de la búsqueda.
   */
  medidasPositivas?: boolean;
  /**
   * Sólo productos con dato (cualquier valor) de TODAS estas claves estructuradas: mide la
   * cobertura de una clave en un universo. Sin `atributosEstructurados` no filtra.
   */
  conClaves?: ClaveEstructurada[];
  /**
   * Sólo conteos de la búsqueda v2: el NOMBRE exhibido tiene TODAS estas palabras (al comienzo de
   * palabra). Para saber si un filtro duro de categoría deja afuera productos que se llaman como
   * se pidió (busqueda-v2/entender/combinar.ts).
   */
  nombreConTodos?: string[];
  /**
   * Sólo facetas: no calcular la de atributos (flag `busqueda-ia` apagado: el
   * panel queda como siempre y no se paga esa consulta). Sale `atributos: []`.
   */
  sinFacetaAtributos?: boolean;
  /**
   * Sólo facetas: no calcular la de categorías, que sale `[]`. El panel del Shop muestra el total
   * fijo de cada categoría (`getFacetaCategorias`, de la caché compartida), no el de la búsqueda.
   */
  sinFacetaCategorias?: boolean;
  /**
   * `public.catalog_atributos` se puede leer (flag `busqueda-ia` + tabla disponible, lo decide la
   * page con `atributosEstructuradosDisponibles`). Con él, `atributos` mira primero el dato
   * estructurado, hay filtro y faceta de potencia, y los productos traen sus características.
   * Sin él, todo como en la fase 1 (y `potenciaMin`/`potenciaMax` se ignoran).
   */
  atributosEstructurados?: boolean;
  /**
   * `catalog_atributos` legible (lo decide la page por request, con `atributosEstructuradosDisponibles`;
   * no depende de `busqueda-ia`). Con él, las facetas suman `porClave` y `caracteristicas` filtra; sin él,
   * `caracteristicas` se ignora y el panel no ofrece características.
   */
  facetasPorTipo?: boolean;
  /**
   * Ids `?car=` (catalogo-car.ts, ya validados): filtro ESTRICTO por característica (solo productos con el
   * dato y que lo cumplen). OR dentro de la clave, AND entre claves. Distinto de `atributos` (`?atr=`).
   */
  caracteristicas?: string[];
  /** Extremos inclusivos de la potencia en watts (sólo productos con `potencia_w`). */
  potenciaMin?: number;
  potenciaMax?: number;
  /** Extremos inclusivos del rango, sobre el precio exhibido (con IVA). */
  precioMin?: number;
  precioMax?: number;
  /** Sólo productos con disponibilidad (ver `condicionesDe`). */
  soloStock?: boolean;
}

/** Los mismos filtros sin texto: lo único que un llamador le pasa al motor (que arma el `texto` de cada etapa). */
export type FiltrosSinTexto = Omit<FiltrosCatalogo, "texto">;

export interface PaginaCatalogo {
  productos: Product[];
  /** Total de productos que cumplen los filtros (no los de esta página). */
  total: number;
  /** Página efectiva, 1-based y ya acotada al rango válido. */
  pagina: number;
  /** Cantidad de páginas. 0 productos ⇒ 1 página (la vacía). */
  paginas: number;
  /**
   * `false` si se pidió `sinConteo`: `total` es sólo lo que trajo la consulta (una cota inferior).
   * Ausente en los resultados que no lo informan.
   */
  totalExacto?: boolean;
}

/** El texto efectivo de unos filtros. Siempre un objeto y con `q` recortada: sin texto, `q` es "". */
const textoDe = (f: Pick<FiltrosCatalogo, "texto">): TextoBusqueda => ({ ...f.texto, q: f.texto?.q.trim() ?? "" });

/**
 * Marca efectiva del producto, en SQL. Tiene que replicar el fallback de
 * `mapFilaToProduct`: si el customField de Alegra vino vacío, la marca que se
 * exhibe (y por la que se filtra) es el nombre de la categoría; con
 * `mostrar_marca = false` en el overlay no hay marca. Requiere el join al overlay.
 */
const marcaSql = sql<string>`(case when ${crmOverlay.mostrarMarca} is false then null
  else coalesce(nullif(${crmCatalogo.brand}, ''), ${crmCategoriasAlegra.name}) end)`;

/**
 * Marca cruda del producto: el customField de Alegra o, vacío, la categoría de Alegra. Igual
 * que `marcaSql` pero SIN `mostrar_marca` (ver `FiltrosCatalogo.marcasPropias`).
 */
const marcaPropiaSql = sql<string>`coalesce(nullif(${crmCatalogo.brand}, ''), ${crmCategoriasAlegra.name})`;

/** El código del producto (en `code` o en `name`, según el ítem) entre estos, sin mayúsculas ni espacios. */
function coincideCodigoSql(skus: readonly string[]) {
  const codigos = [...new Set(skus.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (codigos.length === 0) return undefined;
  return or(
    inArray(sql`upper(btrim(${crmCatalogo.code}))`, codigos),
    inArray(sql`upper(btrim(${crmCatalogo.name}))`, codigos),
  );
}

/** Ver `FiltrosCatalogo.linea`. `undefined` = no filtra. */
function filtroLineaSql(linea: FiltrosCatalogo["linea"]) {
  if (!linea) return undefined;
  const porCategoria = linea.categorias.length ? filtroCategoriasSql(linea.categorias) : undefined;
  const porCodigo = coincideCodigoSql(linea.skus);
  if (!porCategoria && !porCodigo) return undefined;
  return or(porCategoria, porCodigo);
}

/**
 * Precio de lista principal, extraído del jsonb `prices`. Equivalente en SQL de
 * `precioDeLista` sin lista de cliente: el que tiene `main`, si no el primero.
 * El guard de `jsonb_typeof` evita que `jsonb_array_elements` explote si algún
 * ítem quedó con precios que no son un array. Son los precios crudos de
 * Alegra (`precios_alegra` de la vista): `price` y `main` tal cual.
 */
const precioSql = sql<string>`coalesce(
  case when jsonb_typeof(${preciosSql}) = 'array' then (
    select (elem->>'price')::numeric
    from jsonb_array_elements(${preciosSql}) elem
    where (elem->>'main')::boolean
    limit 1
  ) end,
  case when jsonb_typeof(${preciosSql}) = 'array'
    then (${preciosSql}->0->>'price')::numeric end,
  0
)`;

/**
 * Precio que ve el visitante, en SQL: el final con IVA cuando se conoce la
 * alícuota, si no el neto — mismo criterio que `precioExhibido` del cliente.
 * No replica el redondeo al centavo de `precioFinal()`: acá se usa para
 * ORDENAR, para el rango de precio del slider y para el filtro por rango, que
 * viaja en enteros (`precio_min`/`precio_max`), así que el borde `>=`/`<=`
 * sobre el valor sin redondear es indistinguible para el visitante. El número
 * que se muestra sigue saliendo de `mapFilaToProduct`.
 */
const precioExhibidoSql = sql<string>`${precioSql} * (1 + coalesce(${crmCatalogo.ivaPorcentaje}, 0) / 100)`;

/**
 * Precio general VIGENTE en SQL (campañas de precios, spec 2026-10-28-campanias-precios-design.md):
 * con campañas activas, el de campaña de la lista general (`main`, si no la primera) de la primera
 * entrada de `campanias_online` cuya id está activa; si no, `precioSql`. Es el equivalente de
 * `campaniaParaExhibir` para ORDENAR, filtrar por rango y armar el slider, así el catálogo ordena
 * por el precio que muestra la card. Una regla con límite de unidades agotada no rige (cuenta los
 * pedidos sólo en las filas con límite, que son pocas).
 */
function precioVigenteSql(idsCampanias: readonly string[] | undefined) {
  if (!idsCampanias?.length) return precioSql;
  const ids = sql`array[${sql.join(idsCampanias.map((i) => sql`${i}`), sql`, `)}]::text[]`;
  const campanias = crmCatalogo.campaniasOnline;
  return sql<string>`coalesce((
    select (pe->>'price')::numeric
    from jsonb_array_elements(case when jsonb_typeof(${campanias}) = 'array' then ${campanias} else '[]'::jsonb end) e
    cross join jsonb_array_elements(case when jsonb_typeof(e->'precios') = 'array' then e->'precios' else '[]'::jsonb end) pe
    where e->>'id' = any(${ids})
      and (pe->>'price')::numeric > 0
      -- Regla con límite de unidades agotada: rige el precio normal (mismo criterio de conteo que
      -- \`unidadesUsadas\`, lib/campanias/unidades.ts).
      and (e->>'unidades' is null or (
        select coalesce(sum(oi.qty), 0)
        from shop.order_items oi
        join shop.orders o on o.id = oi.order_id
        where o.tenant_id = ${crmCatalogo.tenantId}
          and oi.campania_regla_id::text = e->>'reglaId'
          and o.estado <> 'cancelado'
          and (o.estado <> 'pendiente' or o.pago_estado = 'pagado'
               or coalesce(o.reserva_vence_en, o.created_at + interval '24 hours') > now())
      ) < (e->>'unidades')::numeric)
      and pe->>'idPriceList' = coalesce(
        case when jsonb_typeof(${preciosSql}) = 'array' then (
          select m->>'idPriceList' from jsonb_array_elements(${preciosSql}) m where (m->>'main')::boolean limit 1
        ) end,
        case when jsonb_typeof(${preciosSql}) = 'array' then ${preciosSql}->0->>'idPriceList' end
      )
    limit 1
  ), ${precioSql})`;
}

/** `precioExhibidoSql` con el precio vigente (ver `precioVigenteSql`). Sin campañas, el mismo SQL. */
function precioExhibidoVigenteSql(idsCampanias: readonly string[] | undefined) {
  return idsCampanias?.length
    ? sql<string>`${precioVigenteSql(idsCampanias)} * (1 + coalesce(${crmCatalogo.ivaPorcentaje}, 0) / 100)`
    : precioExhibidoSql;
}

/**
 * Sólo productos con precio. Un ítem sin precio en Alegra resuelve a 0 en
 * `precioSql`; listarlo lo mostraría a "$ 0" con botón de comprar y la venta
 * saldría a precio cero. El control de fondo es la visibilidad del overlay del
 * CRM; esto es la red de seguridad del Shop para todo listado público.
 */
export const conPrecioSql = sql`${precioSql} > 0`;

/**
 * "Solo con stock", en SQL. Replica `derivarStock`: null = no inventariable
 * = disponible; `<= 0` = sin stock.
 */
export const conStock = (disp?: ContextoDisponibilidad, modalidades: readonly VentaSinStock[] = []) => {
  // Con `disp`, del join lateral (`joinStock`): calculado una vez por fila, no dos.
  const stock = disp ? disponibleSucursalSql : stockSql;
  if (!modalidades.length) return sql`(${stock} is null or ${stock} > 0)`;
  // Venta sin stock: un producto a pedido cuenta como "con stock" (se puede comprar). En TS es
  // `esAPedido` (stock "out" + `ventaSinStock`), que `derivarStock` no expresa.
  return sql`(${stock} is null or ${stock} > 0 or ${aPedidoSql(modalidades, disp)})`;
};

/** El contexto si admite traslado (ver `ContextoDisponibilidad.traslado`); si no, undefined. */
const conTraslado = (disp?: ContextoDisponibilidad) => (disp?.traslado ? disp : undefined);

/**
 * ¿Alguna sucursal alcanzable (la unión de `contextoUnion`) tiene stock disponible? Expresión por
 * fila CON parámetros (tenant y slugs): sólo se emite con modalidades activas y un contexto con
 * traslado, y cuesta las subconsultas por sucursal de `stockSucursalSql` (un caso: retiro con
 * `retiro_sin_stock = ofrecer`). NULL (no inventariable) cuenta como false: ese producto ya tiene stock.
 */
const cubreOtraSql = (disp: ContextoDisponibilidad) =>
  sql<boolean>`coalesce(${stockSucursalSql(contextoUnion(disp))} > 0, false)`;

/**
 * El producto tiene asignada una modalidad de venta sin stock ACTIVA. Los ids van como LITERAL, no
 * parámetro: `ordenDestacadosSql` repite la expresión y exige que sea idéntica (ver su comentario).
 * Con un contexto con traslado, además ninguna sucursal alcanzable lo cubre (si no, el pedido lo
 * trae de otra y no es "a pedido"); esa parte sí lleva parámetros.
 */
function aPedidoSql(modalidades: readonly VentaSinStock[], disp?: ContextoDisponibilidad) {
  const asignada = sql`${crmOverlay.modalidadSinStockId} = any(${literal(literalUuids(modalidades.map((m) => m.id)))}::uuid[])`;
  const traslado = conTraslado(disp);
  return traslado ? sql`(${asignada} and not ${cubreOtraSql(traslado)})` : asignada;
}

/**
 * ¿El tenant ya armó su árbol de categorías en el CRM? Mientras no tenga
 * ninguna, todo sigue con las de Alegra.
 */
const hayArbolSql = () =>
  sql`exists (select 1 from ${crmCategorias} where activa and tenant_id = ${shopTenantId()})`;

/**
 * Filtro por categorías, por NOMBRE (es lo que viaja en `?categoria=`).
 *
 * Con árbol propio, una categoría incluye todo su subárbol: tildar
 * "ILUMINACION" trae también lo clasificado en "Focos led". El producto se
 * ubica por la categoría que le asignaron en el CRM (`catalog_overlay`); sin
 * clasificar no cae en ninguna. Sin árbol, el filtro de siempre sobre la
 * categoría de Alegra.
 */
function filtroCategoriasSql(nombres: string[]) {
  const lista = sql.join(
    nombres.map((n) => sql`${n}`),
    sql`, `,
  );
  const tenant = shopTenantId();
  const subarbol = sql`(
    with recursive arbol as (
      select id from ${crmCategorias} where activa and tenant_id = ${tenant} and nombre in (${lista})
      union all
      select c.id from ${crmCategorias} c join arbol a on c.parent_id = a.id where c.activa
    )
    select id from arbol
  )`;
  return sql`((${hayArbolSql()} and ${crmOverlay.categoriaId} in ${subarbol})
    or (not ${hayArbolSql()} and ${inArray(crmCategoriasAlegra.name, nombres)}))`;
}

/** Categoría propia activa, tal como la necesitan el menú y las facetas. */
interface NodoCategoria {
  id: string;
  parentId: string | null;
  nombre: string;
  orden: number;
}

/**
 * Árbol de categorías propias activas del tenant. Vacío = todavía no armó
 * ninguna. Deduplicado por request (`cache` de React): también lo lee la
 * interpretación de búsquedas (busqueda-inteligente/).
 */
export const getArbolCategorias = cache(async function getArbolCategorias(): Promise<NodoCategoria[]> {
  return getDb()
    .select({
      id: crmCategorias.id,
      parentId: crmCategorias.parentId,
      nombre: crmCategorias.nombre,
      orden: crmCategorias.orden,
    })
    .from(crmCategorias)
    .where(and(eq(crmCategorias.tenantId, shopTenantId()), eq(crmCategorias.activa, true)));
});

/**
 * Nombres de una categoría propia y de las que la contienen, de la raíz a ella
 * (para las migas de la ficha). Vacío si no está en el árbol o si cuelga de
 * una inactiva: igual que en el menú, una inactiva corta su rama.
 */
export function rutaEnArbol(arbol: NodoCategoria[], id: string): string[] {
  const porId = new Map(arbol.map((n) => [n.id, n]));
  const ruta: string[] = [];
  const vistos = new Set<string>();
  let n = porId.get(id);
  while (n && !vistos.has(n.id)) {
    vistos.add(n.id);
    ruta.unshift(n.nombre);
    if (!n.parentId) return ruta;
    n = porId.get(n.parentId);
  }
  return [];
}

/** Ruta de una categoría propia en el árbol activo del tenant (ver `rutaEnArbol`). */
export async function getRutaCategoriaPropia(id: string): Promise<string[]> {
  return rutaEnArbol(await getArbolCategorias(), id);
}

/**
 * Suma los conteos por categoría hacia arriba (cada producto cuenta en su
 * categoría y en todas las que la contienen) y devuelve el árbol en orden de
 * lectura —una rama entera antes de la siguiente—, sin las ramas vacías.
 * Una categoría inactiva corta su rama: lo que cuelga de ella no se muestra.
 */
export function enArbolConConteo(
  arbol: NodoCategoria[],
  conteos: Map<string, number>,
): (Faceta & { nivel: number })[] {
  const porId = new Map(arbol.map((n) => [n.id, n]));
  const total = new Map<string, number>();
  for (const [id, cantidad] of conteos) {
    const vistos = new Set<string>();
    for (let n = porId.get(id); n && !vistos.has(n.id); n = n.parentId ? porId.get(n.parentId) : undefined) {
      vistos.add(n.id);
      total.set(n.id, (total.get(n.id) ?? 0) + cantidad);
    }
  }
  const hijas = (parentId: string | null) =>
    arbol
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const salida: (Faceta & { nivel: number })[] = [];
  const recorrer = (parentId: string | null, nivel: number) => {
    for (const n of hijas(parentId)) {
      const count = total.get(n.id) ?? 0;
      if (count === 0) continue;
      salida.push({ label: n.nombre, count, nivel });
      recorrer(n.id, nivel + 1);
    }
  };
  recorrer(null, 1);
  return salida;
}

/**
 * El árbol del panel de filtros: las mismas categorías que el catálogo sin
 * filtros (`base`, sin las vacías), cada una con lo que cuenta dentro de la
 * búsqueda y los demás filtros (`filtrado`), 0 incluido. Así filtrar no deja
 * el panel con una sola categoría.
 */
export function arbolCompletoConConteo(
  arbol: NodoCategoria[],
  base: Map<string, number>,
  filtrado: Map<string, number>,
): (Faceta & { nivel: number })[] {
  const conteo = new Map(enArbolConConteo(arbol, filtrado).map((c) => [c.label, c.count]));
  return enArbolConConteo(arbol, base).map((c) => ({ ...c, count: conteo.get(c.label) ?? 0 }));
}

/** Productos por categoría propia (sólo la directa; `enArbolConConteo` suma hacia arriba). */
async function conteoPorCategoriaPropia(
  where: ReturnType<typeof condicionesDe>,
  agrupar: boolean,
  disp?: ContextoDisponibilidad,
) {
  const filas = await getDb()
    .select({ id: crmOverlay.categoriaId, count: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(agrupar))
    .leftJoin(...joinStock(disp))
    .where(and(where, sql`${crmOverlay.categoriaId} is not null`))
    .groupBy(crmOverlay.categoriaId);
  return new Map(filas.map((f) => [f.id as string, Number(f.count)]));
}

/**
 * Sin árbol propio: las categorías de Alegra del catálogo sin filtros (`base`, ya ordenadas),
 * cada una con lo que cuenta dentro de la búsqueda y los demás filtros (`filtrado`), 0 incluido.
 * Igual que `arbolCompletoConConteo`: el panel siempre lista todas y se puede tildar cualquiera.
 */
export function categoriasPlanasConConteo(base: Faceta[], filtrado: Faceta[]): Faceta[] {
  const conteo = new Map(filtrado.map((c) => [c.label, c.count]));
  return base.map((c) => ({ ...c, count: conteo.get(c.label) ?? 0 }));
}

/** Productos por categoría de Alegra, de más a menos y por nombre (sin árbol propio). */
async function conteoPorCategoriaAlegra(
  where: ReturnType<typeof condicionesDe>,
  agrupar: boolean,
  disp?: ContextoDisponibilidad,
): Promise<Faceta[]> {
  return getDb()
    .select({
      label: sql<string>`${crmCategoriasAlegra.name}`,
      count: sql<number>`count(*)::int`,
    })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(agrupar))
    .leftJoin(...joinStock(disp))
    .where(and(where, sql`nullif(${crmCategoriasAlegra.name}, '') is not null`))
    .groupBy(crmCategoriasAlegra.name)
    .orderBy(sql`count(*) desc`, asc(crmCategoriasAlegra.name));
}

/**
 * Faceta de categorías: el árbol completo del catálogo (sin filtros), cada nodo con lo que cuenta
 * dentro de `filtros` (0 incluido). Sin búsqueda, el panel la pide con el default de stock y nada
 * más, así el número de cada categoría es un total fijo (ver `categoriasTotalesPublicas`); con texto
 * buscado, la page usa la de la búsqueda (`Facetas.categoriasEnBusqueda`).
 */
export async function getFacetaCategorias(
  filtros: FiltrosCatalogo,
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
  /** Flag `variantes-selector`: cuenta un producto por modelo (ver `enListado`). */
  agrupar = false,
): Promise<Faceta[]> {
  const modalidades = await modalidadesActivas();
  const whereCategorias = condicionesDe(
    filtros,
    { ...APLICAR_TODOS, categorias: false },
    soloVisibles,
    agrupar,
    disp,
    modalidades,
  );
  const arbol = await getArbolCategorias();
  // Lo que no acota el conjunto sólo cambia qué se calcula.
  const sinFiltros = Object.entries(filtros).every(
    ([k, v]) =>
      k === "sinFacetaAtributos" ||
      k === "sinFacetaCategorias" ||
      k === "atributosEstructurados" ||
      v === undefined ||
      v === false ||
      (Array.isArray(v) && v.length === 0),
  );
  if (arbol.length) {
    const [base, filtrado] = await Promise.all([
      conteoPorCategoriaPropia(condicionesDe({}, APLICAR_TODOS, soloVisibles, agrupar, disp, modalidades), agrupar, disp),
      conteoPorCategoriaPropia(whereCategorias, agrupar, disp),
    ]);
    return arbolCompletoConConteo(arbol, base, filtrado);
  }
  const [base, filtrado] = await Promise.all([
    // Sin filtros el conteo ya es el del catálogo entero: no hace falta la segunda consulta.
    sinFiltros
      ? null
      : conteoPorCategoriaAlegra(
          condicionesDe({}, APLICAR_TODOS, soloVisibles, agrupar, disp, modalidades),
          agrupar,
          disp,
        ),
    conteoPorCategoriaAlegra(whereCategorias, agrupar, disp),
  ]);
  return base ? categoriasPlanasConConteo(base, filtrado) : filtrado;
}

/** Qué grupos de filtros entran en un WHERE (ver `condicionesDe`). */
interface AplicarFiltros {
  categorias: boolean;
  marcas: boolean;
  atributos: boolean;
  precio: boolean;
  potencia: boolean;
  /** El filtro estricto `?car=` (facetas por tipo). */
  car: boolean;
  stock: boolean;
}

const APLICAR_TODOS: AplicarFiltros = {
  categorias: true,
  marcas: true,
  atributos: true,
  precio: true,
  potencia: true,
  car: true,
  stock: true,
};

/**
 * Condición de texto cuando el plan no trae nada que recupere: con filtros duros, ninguna (las
 * palabras eran contexto: "luz cálida para el living" son las lámparas cálidas); sin ellos,
 * cualquiera de sus términos aunque sean de contexto (`condicionAmplia`). Sin plan, la clásica.
 */
function textoSinPlan(
  filtros: FiltrosCatalogo,
  texto: TextoBusqueda,
  disp?: ContextoDisponibilidad,
  modalidades: readonly VentaSinStock[] = [],
) {
  if (texto.plan) {
    if (filtros.categorias?.length || filtros.atributos?.length) return undefined;
    const amplia = condicionAmplia(texto.plan, piezasBusqueda(filtros, disp, modalidades));
    if (amplia) return amplia;
  }
  return texto.q ? textoClasico(texto) : undefined;
}

/**
 * Piezas SQL del catálogo para la búsqueda v2 (busqueda-v2/piezas.ts): el texto buscable, dónde
 * pesa un término, categorías con su subárbol, atributos y stock del contexto de sucursal.
 */
function piezasBusqueda(
  filtros: FiltrosCatalogo,
  disp?: ContextoDisponibilidad,
  /** Con modalidades activas, "con stock" incluye los a pedido (el mismo predicado que el filtro). */
  modalidades: readonly VentaSinStock[] = [],
): PiezasBusqueda {
  const ctx = contextoAtributos(filtros);
  return {
    texto: textoBuscableSql(),
    nombre: sinTildes(nombreExhibidoSql),
    codigo: sinTildes(crmCatalogo.code),
    marcaCategoria: sinTildes(sql`concat_ws(' ', ${marcaSql}, ${crmCategoriasAlegra.name})`),
    enCategorias: filtroCategoriasSql,
    cumpleAtributo: (id) => cumpleAtributoSql(ctx, id),
    contradiceAtributo: (id) => contradiceIdAtributoSql(ctx, id),
    conStock: conStock(disp, modalidades),
    potencia: potenciaSql(),
  };
}

/**
 * WHERE compartido por la página, el conteo y las facetas.
 *
 * `aplicar` dice qué grupos de filtros entran. La grilla los usa todos; cada
 * faceta excluye su propio grupo (ver `getFacetas`).
 */
function condicionesDe(
  filtros: FiltrosCatalogo,
  aplicar: AplicarFiltros,
  soloVisibles: boolean,
  /** Flag `variantes-selector`: sólo el representante de cada modelo (ver `enListado`). */
  agrupar: boolean,
  disp?: ContextoDisponibilidad,
  /** Modalidades de venta sin stock activas: "con stock" incluye los a pedido (ver `conStock`). */
  modalidades: readonly VentaSinStock[] = [],
) {
  const texto = textoDe(filtros);
  // Con plan (búsqueda v2) el texto recupera en vez de filtrar; sin nada que recupere, la clásica.
  const piezas = texto.plan ? piezasBusqueda(filtros, disp, modalidades) : undefined;
  const recuperarPlan = texto.plan && piezas ? condicionRecuperar(texto.plan, piezas) : undefined;
  // Segundo intento con plan: lo que recupera el plan o se le parece (los duros siguen siendo filtros).
  const recuperarSinAcotar = texto.plan && texto.tolerante && piezas ? recuperarTolerante(texto.plan, recuperarPlan, piezas) : recuperarPlan;
  // Lo que el plan dedujo como categoría acota (sin chip): ver `acotarPorDeducidas`.
  const recuperar = texto.plan && piezas ? acotarPorDeducidas(texto.plan, piezas, recuperarSinAcotar) : recuperarSinAcotar;
  const nombre = filtros.nombreConTodos?.length ? (piezas ?? piezasBusqueda(filtros, disp, modalidades)).nombre : undefined;
  return and(
    enTenantCatalogo(),
    activoSql,
    enListado(agrupar),
    conPrecioSql,
    soloVisiblesSql(soloVisibles),
    visibleEnZonaSql(disp),
    recuperar ?? textoSinPlan(filtros, texto, disp, modalidades),
    aplicar.categorias && filtros.categorias?.length
      ? filtroCategoriasSql(filtros.categorias)
      : undefined,
    aplicar.marcas && filtros.marcas?.length
      ? inArray(marcaSql, filtros.marcas)
      : undefined,
    aplicar.marcas && filtros.marcasPropias?.length
      ? inArray(marcaPropiaSql, filtros.marcasPropias)
      : undefined,
    aplicar.categorias ? filtroLineaSql(filtros.linea) : undefined,
    aplicar.atributos ? filtroAtributosSql(contextoAtributos(filtros), filtros.atributos) : undefined,
    aplicar.atributos ? filtroConClavesSql(filtros) : undefined,
    nombre && filtros.nombreConTodos ? and(...filtros.nombreConTodos.map((t) => sql`${nombre} ~ ${patronTermino(t)}`)) : undefined,
    aplicar.potencia && filtros.atributosEstructurados
      ? filtroPotenciaSql(filtros.potenciaMin, filtros.potenciaMax)
      : undefined,
    aplicar.car && conFacetasPorTipo(filtros) ? filtroCaracteristicasSql(contextoCar, filtros.caracteristicas) : undefined,
    aplicar.precio && filtros.precioMin != null
      ? sql`${precioExhibidoVigenteSql(filtros.precioCampanias)} >= ${filtros.precioMin}`
      : undefined,
    aplicar.precio && filtros.precioMax != null
      ? sql`${precioExhibidoVigenteSql(filtros.precioCampanias)} <= ${filtros.precioMax}`
      : undefined,
    aplicar.stock && filtros.soloStock ? conStock(disp, modalidades) : undefined,
  );
}

/**
 * Lo que el orden "destacados" necesita del árbol de categorías propias, ya calculado en TS
 * (catalogo-destacados.ts): el orden en que se intercalan las categorías (alternando raíces) y
 * las categorías de accesorios.
 */
interface ContextoDestacados {
  intercalado: string[];
  accesorio: string[];
}

/** Contexto de destacados a partir del árbol (vacío = el tenant no armó árbol). */
function contextoDestacados(arbol: NodoCategoria[]): ContextoDestacados {
  return { intercalado: ordenIntercaladoArbol(arbol), accesorio: idsCategoriasAccesorio(arbol) };
}

/**
 * ORDER BY de "Destacados" (default sin búsqueda), claves lexicográficas sobre TODO el conjunto
 * filtrado (no sólo la página, así la paginación queda estable):
 * 1. destacados a mano del admin (`catalog_overlay.orden` no nulo): primero, por `orden` asc. Un
 *    destacado de una subcategoría sale primero también en sus categorías ancestras y sin categoría.
 *    Los de `orden` 9999 (destacado sin posición) empatan y se ordenan por las claves siguientes;
 * 2. escalón: con stock → con foto → no accesorio → stock holgado (≥ STOCK_HOLGADO o no
 *    inventariable). Accesorio = categoría propia o ancestra, o de Alegra, que arranca con
 *    accesorios/repuestos, o nombre que arranca por una palabra de accesorio (catalogo-destacados.ts);
 * 3. ronda: el puesto del producto dentro de su escalón y su subcategoría. Ordenar por la ronda
 *    intercala las subcategorías (el 1.º de cada una, después el 2.º…). Dentro de la subcategoría el
 *    puesto NO sale del stock bruto (premiaba consumibles de miles de unidades) sino del precio en
 *    tramos (×√10, de mayor a menor: el producto "principal" suele valer más que sus consumibles);
 * 4. dentro de la ronda, la subcategoría según `ordenIntercaladoArbol`: alterna raíces (la 1.ª
 *    subcategoría de cada raíz, después la 2.ª…), así la vidriera general mezcla rubros; con una
 *    categoría elegida es el orden de lectura de su subárbol. Sin árbol, la categoría de Alegra;
 * 5. nombre y `alegra_id`: desempate estable.
 * Sólo ordena: no saca a nadie del resultado.
 */
/**
 * Literal de texto de SQL para constantes PROPIAS (patrones de catalogo-destacados.ts y literales
 * de uuids ya validados): nunca para datos de afuera. Tira si trae una comilla.
 */
function literal(texto: string) {
  if (texto.includes("'") || texto.includes("\\")) throw new Error("literal: texto no apto");
  return sql.raw(`'${texto}'`);
}

/** Unidades desde las que el stock de un destacado se considera holgado (ver `ordenDestacadosSql`). */
const STOCK_HOLGADO = 3;

function ordenDestacadosSql(
  ctx: ContextoDestacados,
  disp?: ContextoDisponibilidad,
  modalidades: readonly VentaSinStock[] = [],
) {
  // Postgres calcula UNA vez las expresiones idénticas que se repiten (la clave del PARTITION BY y el
  // argumento de `first_value`), y dos parámetros ($6 y $9) no son idénticos. Por eso todo va como
  // literal: las constantes propias con `literal`. El stock por sucursal es la columna del join
  // lateral (`joinStock`): ya calculado una vez por fila para el filtro "con stock", sin parámetros.
  const stock = disp ? disponibleSucursalSql : stockSql;
  const holgado = sql.raw(String(STOCK_HOLGADO));
  // Stock en 0..STOCK_HOLGADO (null = no inventariable = holgado), evaluado una sola vez.
  const nivelStock = sql`greatest(least(coalesce(${stock}, ${holgado}), ${holgado}), 0)`;
  const sinFoto = sql`(case when jsonb_typeof(${crmOverlay.fotos}) = 'array' and jsonb_array_length(${crmOverlay.fotos}) > 0 then 0 else 1 end)`;
  const accesorio = sql`(case when ${crmOverlay.categoriaId} = any(${literal(literalUuids(ctx.accesorio))}::uuid[])
      or coalesce(btrim(${sinTildes(crmCategoriasAlegra.name)}) ~ ${literal(PATRON_CATEGORIA_ACCESORIO)}, false)
      or btrim(lower(${nombreExhibidoSql})) ~ ${literal(PATRON_NOMBRE_ACCESORIO)}
    then 1 else 0 end)`;
  const grupo = sql`coalesce(${crmOverlay.categoriaId}::text, ${crmCategoriasAlegra.name}, '')`;
  // Precio aproximado y barato (el primero de la lista, sin IVA): para tramos de ×√10 alcanza, y
  // evita el `jsonb_array_elements` por fila de `precioSql`.
  const precioAprox = sql`(case when jsonb_typeof(${preciosSql}) = 'array' then (${preciosSql}->0->>'price')::numeric end)`;
  // En float8: `log` de numeric es de precisión arbitraria y costaba ~15 µs por fila.
  const tramoPrecio = sql`floor(log(greatest(coalesce(${precioAprox}, 1), 1)::float8) * 2)`;
  // Escalón como UNA clave: sin stock (8) > sin foto (4) > accesorio (2) > stock corto (1). La
  // ventana lo calcula una vez por fila y el ORDER BY lo lee de ella (`first_value`): repetir las
  // expresiones afuera hacía que Postgres las evaluara de nuevo.
  // Venta sin stock: un producto a pedido (sin stock, con modalidad activa) pesa como stock corto (1).
  const sinStock = modalidades.length ? sql`(case when ${aPedidoSql(modalidades, disp)} then 1 else 8 end)` : sql`8`;
  const escalon = sql`((case ${nivelStock} when 0 then ${sinStock} when ${holgado} then 0 else 1 end) + ${sinFoto} * 4 + ${accesorio} * 2)`;
  const ventana = sql`over (
    partition by ${escalon}, ${grupo}
    order by ${tramoPrecio} desc, ${crmCatalogo.name}, ${crmCatalogo.alegraId})`;
  const posicionGrupo = sql`array_position(${literal(literalUuids(ctx.intercalado))}::uuid[], ${crmOverlay.categoriaId})`;
  return [
    sql`(${crmOverlay.orden} is null) asc`,
    sql`${crmOverlay.orden} asc`,
    sql`first_value(${escalon}) ${ventana} asc`,
    sql`row_number() ${ventana} asc`,
    sql`${posicionGrupo} asc nulls last`,
    sql`${grupo} asc`,
    asc(crmCatalogo.name),
    asc(crmCatalogo.alegraId),
  ];
}

/**
 * ORDER BY según el criterio elegido. Sin búsqueda el default es `destacados`
 * (ver `ordenDestacadosSql`); `nombre` es el alfabético.
 * El desempate por nombre mantiene la paginación estable (sin él, dos productos
 * del mismo precio pueden intercambiarse entre páginas).
 *
 * En `relevancia`, antes del nombre desempatan: estar en alguna categoría que
 * entendió el plan (duras o blandas; importa donde los duros no filtran, como
 * el autocompletar) y el stock (más primero; los no inventariables al final):
 * entre dos productos que responden igual de bien, el del tipo pedido y el que
 * más se mueve. Con el alfabético, "Reflector industrial" le ganaba a
 * todos los "Reflector LED" sólo por la letra.
 */
const desempateRelevancia = (disp?: ContextoDisponibilidad, categorias?: string[]) => [
  ...(categorias?.length ? [sql`(case when ${filtroCategoriasSql(categorias)} then 0 else 1 end) asc`] : []),
  // Con `disp`, la columna del join lateral (`joinStock`): una vez por fila, no una más para ordenar.
  sql`${disp ? disponibleSucursalSql : stockSql} desc nulls last`,
  asc(crmCatalogo.name),
];

function ordenDe(
  orden: OrdenCatalogo,
  filtros: FiltrosCatalogo,
  disp?: ContextoDisponibilidad,
  destacados?: ContextoDestacados,
  modalidades: readonly VentaSinStock[] = [],
) {
  switch (orden) {
    case "relevancia": {
      // Búsqueda v2: el puntaje del plan, aunque no quede texto filtrando.
      const texto = textoDe(filtros);
      if (texto.plan) {
        // Las deducidas también "cubren" lo que nombran (como cuando eran filtro): en "Lámparas", todo es un foco.
        const categoriasFiltro = [...(filtros.categorias ?? []), ...(texto.plan.deducidas ?? [])];
        const puntaje = puntajeBusqueda(texto.plan, piezasBusqueda(filtros, disp, modalidades), { categoriasFiltro });
        // Segundo intento con plan: el puntaje del plan más el parecido de cada término que recupera.
        const parecido = texto.tolerante
          ? terminosParecidos(texto.plan).map((t) => sql`public.word_similarity(${raizPlural(t)}, ${sinTildes(nombreExhibidoSql)}) * 4`)
          : [];
        return [sql`${parecido.length ? sql.join([puntaje, ...parecido], sql` + `) : puntaje} desc`, ...desempateRelevancia(disp, texto.plan.categoriasDelPlan)];
      }
      // Sin términos útiles no hay con qué puntuar: alfabético.
      if (!texto.q || !terminosBusqueda(texto.q).length) return [asc(crmCatalogo.name)];
      const codigo = texto.codigo ? normalizarCodigo(texto.q) : "";
      return [sql`${relevanciaSql(texto.q, !!texto.tolerante, codigo)} desc`, ...desempateRelevancia(disp)];
    }
    case "precio-asc":
      return [sql`${precioExhibidoVigenteSql(filtros.precioCampanias)} asc`, asc(crmCatalogo.name)];
    case "precio-desc":
      return [sql`${precioExhibidoVigenteSql(filtros.precioCampanias)} desc`, asc(crmCatalogo.name)];
    case "destacados":
      return ordenDestacadosSql(destacados ?? contextoDestacados([]), disp, modalidades);
    default:
      return [asc(crmCatalogo.name)];
  }
}

/** Página 1-based acotada al rango válido. */
export function acotarPagina(pagina: number, paginas: number): number {
  if (!Number.isFinite(pagina)) return 1;
  return Math.min(Math.max(Math.trunc(pagina), 1), Math.max(paginas, 1));
}

/**
 * Una página del catálogo, con los filtros y el orden resueltos en Postgres.
 *
 * Todo esto vivía en el cliente sobre el catálogo entero (~2800 productos por
 * request). Filtrar u ordenar después de paginar daría resultados incompletos,
 * así que las tres cosas se hacen acá, en la misma query.
 */
export async function getPaginaCatalogo(opts: {
  /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
  soloVisibles: boolean;
  /** Flag `variantes-selector`: un representante por modelo y overlay del ancla. Ausente = apagado. */
  agrupar?: boolean;
  filtros?: FiltrosCatalogo;
  orden?: OrdenCatalogo;
  /** 1-based. Si se pasa de largo, se devuelve la última página. */
  pagina?: number;
  porPagina?: number;
  idPriceList?: string;
  /**
   * Contexto de disponibilidad por sucursal (flag `disponibilidad-sucursal`): stock por sucursal y
   * productos ocultos por sucursal. Ausente = stock único, como siempre.
   */
  disp?: ContextoDisponibilidad;
  /** "$X con <Medio>" (ver `mapFilaToProduct`). */
  mediosPrecio?: MediosPrecio;
  /**
   * No contar el total (el autocompletar, el chat y el selector del admin no lo muestran): una
   * consulta menos. `total` pasa a ser lo que trajo la consulta, `pagina` y `paginas` valen 1 y
   * el resultado dice `totalExacto: false`.
   */
  sinConteo?: boolean;
}): Promise<PaginaCatalogo> {
  // Campañas activas (ver `MediosPrecio.campanias`): el orden y el filtro por precio usan el vigente.
  const idsCampanias = opts.mediosPrecio?.campanias?.map((c) => c.id);
  const filtros: FiltrosCatalogo =
    idsCampanias?.length && !opts.filtros?.precioCampanias
      ? { ...(opts.filtros ?? {}), precioCampanias: idsCampanias }
      : (opts.filtros ?? {});
  const porPagina = opts.porPagina ?? PRODUCTOS_POR_PAGINA;
  const agrupar = opts.agrupar ?? false;
  const modalidades = await modalidadesActivas();
  const where = condicionesDe(filtros, APLICAR_TODOS, opts.soloVisibles, agrupar, opts.disp, modalidades);

  const [conteo] = opts.sinConteo
    ? []
    : await getDb()
        .select({ total: sql<number>`count(*)::int` })
        .from(crmCatalogo)
        .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
        .leftJoin(crmOverlay, joinOverlay(agrupar))
        .leftJoin(...joinStock(opts.disp))
        .where(where);

  const total = conteo?.total ?? 0;
  const paginas = Math.max(Math.ceil(total / porPagina), 1);
  const pagina = opts.sinConteo ? 1 : acotarPagina(opts.pagina ?? 1, paginas);
  const orden = opts.orden ?? ORDEN_DEFAULT;
  const hayFilas = Boolean(total || opts.sinConteo);
  // El árbol sólo hace falta para "destacados" (y sólo si hay algo que ordenar).
  const destacados =
    hayFilas && orden === "destacados" ? contextoDestacados(await getArbolCategorias()) : undefined;

  const filas = hayFilas
    ? await getDb()
        .select(columnasCatalogo(opts.disp, filtros.atributosEstructurados, agrupar, modalidades))
        .from(crmCatalogo)
        .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
        .leftJoin(crmOverlay, joinOverlay(agrupar))
        .leftJoin(...joinStock(opts.disp))
        .where(where)
        .orderBy(...ordenDe(orden, filtros, opts.disp, destacados, modalidades))
        .limit(porPagina)
        .offset((pagina - 1) * porPagina)
    : [];

  const medios = await conQuedanCampania(filas, opts.mediosPrecio);
  const mapeados = filas.map((f) => mapFilaToProduct(f, opts.idPriceList, undefined, undefined, medios, modalidades));
  const productos = agrupar ? await conResumenDeVariantes(mapeados, opts.idPriceList, medios) : mapeados;
  if (opts.sinConteo) return { productos, total: productos.length, pagina: 1, paginas: 1, totalExacto: false };
  return { productos, total, pagina, paginas, totalExacto: true };
}

/**
 * Sólo el conteo de productos que cumplen los filtros (sin traer filas). Lo usa la búsqueda v2
 * para decidir si un filtro duro deja resultados antes de aplicarlo.
 */
export async function contarCatalogo(opts: {
  soloVisibles: boolean;
  /** Flag `variantes-selector`: cuenta un producto por modelo. Ausente = apagado. */
  agrupar?: boolean;
  filtros: FiltrosCatalogo;
  disp?: ContextoDisponibilidad;
}): Promise<number> {
  const modalidades = await modalidadesActivas();
  const [conteo] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(opts.agrupar ?? false))
    .leftJoin(...joinStock(opts.disp))
    .where(condicionesDe(opts.filtros, APLICAR_TODOS, opts.soloVisibles, opts.agrupar ?? false, opts.disp, modalidades));
  return conteo?.total ?? 0;
}

/**
 * Producto para la ficha pública, desde la vista del CRM (con el overlay, igual
 * que la card del catálogo). Nada de tráfico público toca Alegra: precio y stock
 * en vivo se validan recién al cotizar y al confirmar el pedido.
 *
 * `null` = no existe o no está publicado (404). Si falla la base, TIRA: un error
 * no puede presentarse como "no existe", o Google saca del índice productos reales.
 */
export async function getProducto(
  id: string,
  opts: {
    /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
    soloVisibles: boolean;
    /** Flag `variantes-selector`: overlay del ancla del grupo (ver `getProductosPorIds`). */
    agrupar?: boolean;
    idPriceList?: string;
    /** Flag `disponibilidad-sucursal`: null si ninguna sucursal que sirve al visitante lo ofrece. */
    disp?: ContextoDisponibilidad;
    /** Sumar características estructuradas (flag `busqueda-ia` + tabla disponible). */
    atributosEstructurados?: boolean;
    /** "$X con <Medio>" (ver `mapFilaToProduct`). */
    mediosPrecio?: MediosPrecio;
  },
): Promise<Product | null> {
  // Un id que no es de producto (entero o `slug:entero`) no se consulta.
  if (!esIdProducto(id)) return null;
  const productos = await getProductosPorIds([id], {
    idPriceList: opts.idPriceList,
    soloActivos: true,
    soloVisibles: opts.soloVisibles,
    agrupar: opts.agrupar,
    disp: opts.disp,
    atributosEstructurados: opts.atributosEstructurados,
    mediosPrecio: opts.mediosPrecio,
  });
  const producto = productos.get(id) ?? null;
  if (!producto || !opts.agrupar) return producto;
  return conGrupoDeFicha(producto, opts);
}

/**
 * Flag `variantes-selector`: para un id que NO se puede mostrar (variante oculta por el admin o
 * inactiva en Alegra, o el id del modelo mismo), el id de otra opción disponible de su modelo: la
 * representante si sigue disponible, si no la primera por etiqueta. `null` si no pertenece a un
 * grupo o ya no le queda ninguna opción (la ficha responde 404). Lee el grupo sin filtrar por
 * activo (la pedida justamente no lo está) y las opciones por `getVariantesDeGrupo`, que sí.
 */
export async function getIdAlternativoDeVariante(
  id: string,
  opts: { soloVisibles: boolean; disp?: ContextoDisponibilidad },
): Promise<string | null> {
  if (!esIdProducto(id)) return null;
  const [fila] = await getDb()
    .select({ grupoId: crmCatalogo.grupoId })
    .from(crmCatalogo)
    .where(and(enTenantCatalogo(), eq(crmCatalogo.alegraId, id)))
    .limit(1);
  if (!fila?.grupoId) return null;
  const opciones = (await getVariantesDeGrupo(fila.grupoId, opts)).filter((o) => o.id !== id);
  return (opciones.find((o) => o.esRepresentante) ?? opciones[0])?.id ?? null;
}

/**
 * Con el flag `variantes-selector`: si el producto es una variante de un modelo con al menos 2
 * opciones activas (y él es una de ellas), le suma `grupo` para que la ficha dibuje el selector. Un
 * producto suelto, un modelo de una sola opción o una variante que no figura entre las opciones
 * (sin precio, oculta) se devuelve tal cual: ficha sin selector.
 */
async function conGrupoDeFicha(producto: Product, opts: Parameters<typeof getProducto>[1]): Promise<Product> {
  const [fila] = await getDb()
    .select({ grupoId: crmCatalogo.grupoId })
    .from(crmCatalogo)
    .where(and(enTenantCatalogo(), eq(crmCatalogo.alegraId, producto.id)))
    .limit(1);
  if (!fila?.grupoId) return producto;
  const encontradas = await getVariantesDeGrupo(fila.grupoId, {
    soloVisibles: opts.soloVisibles,
    idPriceList: opts.idPriceList,
    disp: opts.disp,
    atributosEstructurados: opts.atributosEstructurados,
    mediosPrecio: opts.mediosPrecio,
  });
  if (encontradas.length < 2 || !encontradas.some((o) => o.id === producto.id)) return producto;
  const representanteId = (encontradas.find((o) => o.esRepresentante) ?? encontradas[0]).id;
  const opciones: OpcionFicha[] = encontradas.map(({ id, etiqueta, producto: p }) => ({ id, etiqueta, producto: p }));
  // El producto pedido es el de su propia opción (precio, fotos y stock de ESA variante).
  const propio = opciones.find((o) => o.id === producto.id)?.producto ?? producto;
  return { ...propio, grupo: { representanteId, opciones } };
}

// ---------------------------------------------------------------------------
// Facetas y navegación
// ---------------------------------------------------------------------------

/** Una opcion de filtro con la cantidad real de productos que la cumplen. */
export interface Faceta {
  label: string;
  count: number;
  /** Sólo categorías con árbol propio: 1 = raíz. Sirve para sangrar la lista. */
  nivel?: number;
}

export interface Facetas {
  categorias: Faceta[];
  marcas: Faceta[];
  /**
   * Atributos con conteo > 0 (`label` = id del diccionario; el nombre lo pone
   * la UI con `nombreAtributo`). Cada grupo cuenta con los filtros de los otros.
   */
  atributos: Faceta[];
  /**
   * Rango real de precios exhibidos del conjunto filtrado, sin el propio
   * filtro de precio (límites del slider). null = ningún producto cumple.
   */
  precio: RangoPrecio | null;
  /**
   * Facetas por tipo de producto (con `catalog_atributos` legible): qué características ofrecer para el
   * conjunto (`elegirFacetas`). Ausente = no se calculó (tabla ausente o la consulta falló: el panel
   * no ofrece características); `[]` = nada elegible o sin categoría ni búsqueda.
   */
  porClave?: FacetaClave[];
  /**
   * Locales para el filtro "Con stock en <local>" (activos y con retiro). No salen de Postgres: los
   * agrega la page del catálogo cuando hay más de uno. Ausente = el filtro no se muestra.
   */
  locales?: { slug: string; nombre: string }[];
  /**
   * Las categorías cuentan dentro de esta búsqueda (y de los demás filtros), no el total fijo: lo
   * pone la page del catálogo cuando hay texto buscado y la búsqueda deja productos. Ausente = total.
   */
  categoriasEnBusqueda?: string;
}

/**
 * Conteos de todos los atributos en UNA consulta (ver `columnasConteoAtributos`).
 * El texto normalizado (`immutable_unaccent(lower(concat_ws(…)))`) se calcula
 * una sola vez por fila en una subconsulta y los ~11 patrones corren sobre esa
 * columna. EXPLAIN ANALYZE sobre el catálogo real (2026-09-29): ~160 ms con
 * búsqueda (igual que las otras facetas, que corren en paralelo) y ~210 ms sin
 * búsqueda (antes 160–300 y 220–350 ms); sin búsqueda la faceta sale de la
 * caché compartida del catálogo.
 */
function consultaConteoAtributos(
  where: ReturnType<typeof condicionesDe>,
  atributos: string[] | undefined,
  estructurados = false,
  /** Modo de las medidas dinámicas entre los filtros de los otros grupos (`medidasPositivasDe`). */
  medidaPositiva = false,
  /** El mismo contexto con el que se armó `where` (ver `joinStock`). */
  disp?: ContextoDisponibilidad,
  /** El mismo `agrupar` con el que se armó `where` (ver `joinOverlay`). */
  agrupar = false,
) {
  // Con estructurados, el jsonb de cada producto también se lee UNA vez por fila.
  const filas = getDb()
    .select({
      texto: sql<string>`${textoBuscableSql()}`.as("texto"),
      ...(estructurados ? { attrs: sql<unknown>`${atributosFilaSql()}`.as("attrs") } : {}),
    })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(agrupar))
    .leftJoin(...joinStock(disp))
    .where(where)
    .as("filas_atributos");
  const ctx: ContextoAtributos = estructurados
    ? { texto: sql`${filas.texto}`, attrs: sql`"filas_atributos"."attrs"`, medidaPositiva }
    : { texto: sql`${filas.texto}`, medidaPositiva };
  return getDb().select(columnasConteoAtributos(ctx, atributos)).from(filas);
}

/**
 * Facetas por tipo de producto (catalogo-facetas-sql.ts) en UNA consulta: el conjunto de la página sin
 * ningún `car` ni potencia, con una columna por clave activa que dice si el producto la cumple; los
 * conteos y denominadores salen de una pasada sobre ese conjunto, y `elegirFacetas` decide qué ofrecer.
 * Si la consulta falla, `undefined` (y un log): el panel degrada al de siempre sin romper la página.
 */
async function consultaFacetasPorTipo(
  filtros: FiltrosCatalogo,
  soloVisibles: boolean,
  agrupar: boolean,
  disp?: ContextoDisponibilidad,
  modalidades: readonly VentaSinStock[] = [],
): Promise<FacetaClave[] | undefined> {
  try {
    const condiciones = condicionesPorClave(contextoCar, filtros.caracteristicas, {
      min: filtros.potenciaMin,
      max: filtros.potenciaMax,
    });
    const activas = [...condiciones.keys()];
    const cumple = Object.fromEntries(
      Object.entries(columnasCumpleSql(contextoCar, condiciones)).map(([k, c]) => [k, sql<boolean>`${c}`.as(k)]),
    );
    const base = getDb()
      .select({ id: sql<string>`${crmCatalogo.alegraId}`.as("id"), ...cumple })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay(agrupar))
      .leftJoin(...joinStock(disp))
      .where(
        condicionesDe(filtros, { ...APLICAR_TODOS, car: false, potencia: false }, soloVisibles, agrupar, disp, modalidades),
      );
    const filas = (await getDb().execute(
      consultaFacetasPorTipoSql({ base: base.getSQL(), activas, tenant: shopTenantId() }),
    )) as unknown as FilaFacetasPorTipo[];
    const categoria = filtros.categorias?.length === 1 ? filtros.categorias[0] : undefined;
    return elegirFacetas(entradaDeFilas(filas, activas, categoria));
  } catch (err) {
    console.error("[catalogo] no se pudieron calcular las facetas por tipo:", err);
    return undefined;
  }
}

/**
 * Las facetas por tipo se calculan con categoría, búsqueda o algún `car` activo; sin nada de eso (la
 * entrada al catálogo) no se ofrecen (`[]`, sin consulta) y el panel pide elegir una categoría.
 */
function facetasPorTipoDe(
  filtros: FiltrosCatalogo,
  soloVisibles: boolean,
  agrupar: boolean,
  disp?: ContextoDisponibilidad,
  modalidades: readonly VentaSinStock[] = [],
) {
  if (!conFacetasPorTipo(filtros)) return Promise.resolve(undefined);
  const texto = textoDe(filtros);
  const enContexto = Boolean(filtros.categorias?.length || texto.q || texto.plan || filtros.caracteristicas?.length);
  return enContexto
    ? consultaFacetasPorTipo(filtros, soloVisibles, agrupar, disp, modalidades)
    : Promise.resolve([] as FacetaClave[]);
}

/**
 * Facetas con sus conteos, calculadas en Postgres.
 *
 * Cada faceta cuenta sobre lo que matchea la búsqueda MÁS los filtros de los
 * OTROS grupos, y no sobre el propio: las marcas se cuentan dentro de las
 * categorías tildadas (tildar "Herramientas" deja sólo las marcas que tienen
 * herramientas, con la cantidad que tienen), pero siguen mostrándose todas las
 * categorías disponibles para poder tildar otra sin destildar la primera. Con
 * el mismo criterio, el rango de precio se calcula sobre todo lo demás pero
 * sin el rango vigente: si no, los límites del slider se achicarían a lo que
 * el visitante acaba de elegir y ya no podría volver a abrirlo.
 */
/**
 * Los valores de marca que existen en el catálogo, con su cantidad de productos: el selector
 * del editor de páginas de marca. Marca CRUDA (`marcaPropiaSql`) y sin stock ni zona: una marca
 * sin stock momentáneo o con la marca oculta en las cards sigue apareciendo.
 */
export async function getValoresMarca(soloVisibles: boolean): Promise<{ valor: string; count: number }[]> {
  return getDb()
    .select({ valor: marcaPropiaSql, count: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(false))
    .where(
      and(
        enTenantCatalogo(),
        activoSql,
        enListado(false),
        conPrecioSql,
        soloVisiblesSql(soloVisibles),
        sql`nullif(${marcaPropiaSql}, '') is not null`,
      ),
    )
    .groupBy(marcaPropiaSql)
    .orderBy(sql`count(*) desc`, sql`${marcaPropiaSql} asc`);
}

/**
 * Todas las marcas que muestra el catálogo (`marcaSql`, la que ven las cards), con su cantidad de
 * productos sin búsqueda, sin filtros y sin el filtro de stock: el panel las lista siempre, con 0
 * las que no tienen productos para los filtros vigentes (ver `completarMarcas`).
 */
export async function getMarcasDelCatalogo(
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
  agrupar = false,
): Promise<Faceta[]> {
  const where = condicionesDe({ soloStock: false }, APLICAR_TODOS, soloVisibles, agrupar, disp);
  return getDb()
    .select({ label: marcaSql, count: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay(agrupar))
    .leftJoin(...joinStock(disp))
    .where(and(where, sql`nullif(${marcaSql}, '') is not null`))
    .groupBy(marcaSql)
    .orderBy(sql`count(*) desc`, sql`${marcaSql} asc`);
}

export async function getFacetas(
  filtros: FiltrosCatalogo,
  /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
  soloVisibles: boolean,
  /** Flag `disponibilidad-sucursal` (ver `ContextoDisponibilidad`). */
  disp?: ContextoDisponibilidad,
  /** Flag `variantes-selector`: las facetas cuentan un producto por modelo (ver `enListado`). */
  agrupar = false,
): Promise<Facetas> {
  const modalidades = await modalidadesActivas();
  const where = (aplicar: AplicarFiltros) => condicionesDe(filtros, aplicar, soloVisibles, agrupar, disp, modalidades);
  const whereMarcas = where({ ...APLICAR_TODOS, marcas: false });
  const wherePrecio = where({ ...APLICAR_TODOS, precio: false });
  const whereAtributos = where({ ...APLICAR_TODOS, atributos: false });

  const [categorias, marcas, [rango], [conteoAtributos], porClave] = await Promise.all([
    filtros.sinFacetaCategorias ? Promise.resolve([]) : getFacetaCategorias(filtros, soloVisibles, disp, agrupar),
    getDb()
      .select({ label: marcaSql, count: sql<number>`count(*)::int` })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay(agrupar))
      .leftJoin(...joinStock(disp))
      .where(and(whereMarcas, sql`nullif(${marcaSql}, '') is not null`))
      .groupBy(marcaSql)
      .orderBy(sql`count(*) desc`, sql`${marcaSql} asc`),
    // Enteros hacia afuera (floor/ceil) para que ningún producto quede fuera
    // de los límites que muestra el slider.
    getDb()
      .select({
        min: sql<number | null>`floor(min(${precioExhibidoVigenteSql(filtros.precioCampanias)}))::int`,
        max: sql<number | null>`ceil(max(${precioExhibidoVigenteSql(filtros.precioCampanias)}))::int`,
      })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay(agrupar))
      .leftJoin(...joinStock(disp))
      .where(wherePrecio),
    filtros.sinFacetaAtributos
      ? Promise.resolve([])
      : consultaConteoAtributos(whereAtributos, filtros.atributos, filtros.atributosEstructurados, medidasPositivasDe(filtros), disp, agrupar),
    facetasPorTipoDe(filtros, soloVisibles, agrupar, disp, modalidades),
  ]);

  const precio =
    rango?.min != null && rango?.max != null
      ? { min: rango.min, max: rango.max }
      : null;

  return {
    categorias,
    marcas,
    atributos: facetasDeConteos(conteoAtributos),
    precio,
    ...(porClave !== undefined ? { porClave } : {}),
  };
}



/**
 * Categorías del catálogo, para la navegación (menú del header y grilla del
 * home). Salen del árbol propio del CRM si ya llegó, y si no de las de
 * Alegra; en los dos casos sin las que no tienen ningún producto — una
 * categoría vacía en el menú es un callejón sin salida.
 *
 * Envuelto en `cache` de React para consultarla una sola vez por request.
 * `soloVisibles`: flag `catalogo-solo-visibles` (ver `soloVisiblesSql`).
 * `agrupar`: flag `variantes-selector` (los conteos cuentan un producto por modelo).
 */
export const getCategorias = cache(async function getCategorias(
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
  agrupar = false,
): Promise<string[]> {
  // Con árbol propio el menú muestra sus raíces, en el orden del CRM, contando
  // lo que se publica de verdad (mismo WHERE que la grilla sin filtros).
  const arbol = await getArbolCategorias();
  if (arbol.length) {
    const conteos = await conteoPorCategoriaPropia(
      condicionesDe({}, APLICAR_TODOS, soloVisibles, agrupar, disp),
      agrupar,
      disp,
    );
    return enArbolConConteo(arbol, conteos)
      .filter((c) => c.nivel === 1)
      .map((c) => c.label);
  }

  // Sin árbol: categorías de Alegra activas con al menos un producto activo del
  // tenant. Las dos vistas son de todos los tenants: el tenant va en el ON (el
  // producto y su categoría, del mismo tenant) y en el WHERE de las dos.
  const tenant = shopTenantId();
  const filas = await getDb()
    .selectDistinct({ name: crmCategoriasAlegra.name })
    .from(crmCategoriasAlegra)
    .innerJoin(
      crmCatalogo,
      and(
        eq(crmCatalogo.categoryAlegraId, crmCategoriasAlegra.alegraId),
        eq(crmCatalogo.tenantId, crmCategoriasAlegra.tenantId),
      ),
    )
    .where(
      and(
        eq(crmCategoriasAlegra.tenantId, tenant),
        eq(crmCatalogo.tenantId, tenant),
        eq(crmCategoriasAlegra.activo, true),
        activoSql,
      ),
    )
    .orderBy(asc(crmCategoriasAlegra.name));

  return filas.map((f) => f.name).filter(Boolean);
});

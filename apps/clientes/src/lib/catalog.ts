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
 *   Shop (ver src/lib/stock-disponible.ts). Toda consulta joinea
 *   `stockReservado` para eso.
 *
 * SOLO servidor: usa la DB y el cliente de Alegra. Consumir desde Server
 * Components o API routes, nunca desde el browser.
 *
 * Los campos de marketing (oldPrice, discount, badge) NO vienen de Alegra: son
 * concepto del shop y viven en su propia capa.
 */

import { cache } from "react";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { ProductStock } from "@myd-org/ui";
import { getDb } from "@/db";
import { stockReservado } from "@/db/schema";
import {
  crmAtributos,
  crmCatalogo,
  crmCategorias,
  crmCategoriasAlegra,
  crmOverlay,
  type FichaTecnicaCrm,
  type FotoCrm,
} from "@/db/crm";
import { esIdAlegra, mapPrecios, precioDeLista } from "./alegra";
import { activoSql, joinReserva, preciosSql, stockSql } from "./stock-disponible";
import { enTenantCatalogo, joinCategoriasAlegra } from "./catalogo-fuente";
import { ORDEN_DEFAULT, type OrdenCatalogo, type RangoPrecio } from "./catalogo-url";
import { fotosPermitidas, hostsDeMedios } from "./catalogo-medios";
import { basePublicaMedios } from "./shop-media";
import { shopTenantId } from "./tenant";
import { precioFinal } from "./precio-final";
import { precioCuenta, type PrecioCuenta } from "./precio-cuenta";
import {
  descripcionExhibida,
  joinOverlay,
  nombreExhibido,
  nombreExhibidoSql,
} from "./nombre-exhibido";
import {
  formasTermino,
  patronLike,
  patronPrefijo,
  raizPlural,
  terminosBusqueda,
} from "./catalogo-busqueda";
import type { Product } from "@/data/products";
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";
import { armarPreciosMedios, type MediosPrecio } from "./medios-precio";
import { stockSucursalSql, visibleEnSucursalSql } from "./stock-sucursal";
import {
  columnasConteoAtributos,
  contradiccionSql,
  cumpleAtributoSql,
  facetasDeConteos,
  filtroAtributosSql,
  criterioSql,
  tieneClaveSql,
  type ContextoAtributos,
} from "./catalogo-atributos-sql";
import type { CriterioEstructurado } from "./catalogo-atributos";
import { caracteristicasDe, leerAtributosEstructurados, type ClaveEstructurada } from "./catalogo-caracteristicas";
import { universoAcotado } from "./busqueda-v2/universo-acotado";
import { condicionAmplia, condicionRecuperar } from "./busqueda-v2/recuperar";
import { puntajeBusqueda } from "./busqueda-v2/ordenar";
import type { CriterioPlan, PiezasBusqueda } from "./busqueda-v2/piezas";

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
): Product {
  const qty = fila.stock != null ? Number(fila.stock) : null;
  const precios = mapPrecios(fila.prices);
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
    ...camposIva(price, fila.ivaPorcentaje != null ? Number(fila.ivaPorcentaje) : null),
    ...armarPreciosMedios(precios, fila.ivaPorcentaje != null ? Number(fila.ivaPorcentaje) : null, mediosPrecio),
    stock: derivarStock(qty),
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
    // oldPrice / discount / badge → capa de marketing del shop, no de Alegra.
  };
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
 * stock, menos lo reservado (exige el join a `stockReservado`).
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
const columnasCatalogo = (disp?: ContextoDisponibilidad, estructurados = false) => {
  const base = disp ? { ...COLUMNAS_CATALOGO_BASE, stock: stockSucursalSql(disp) } : COLUMNAS_CATALOGO_BASE;
  return estructurados ? { ...base, atributos: sql<unknown>`${atributosFilaSql()}` } : base;
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

type FiltrosDeAtributos = Pick<
  FiltrosCatalogo,
  "atributosEstructurados" | "medidasPositivas" | "categorias" | "busqueda" | "planBusqueda"
>;

/**
 * Modo de las medidas (ids dinámicos de atributo) como filtro: positivo si la consulta no tiene
 * universo acotado ("20a", `?atr=corriente_a:20` a mano), sin contradicción si lo tiene. Lo fuerza
 * `medidasPositivas`. Los ids del diccionario no dependen de esto.
 */
const medidasPositivasDe = (filtros: FiltrosDeAtributos): boolean => filtros.medidasPositivas ?? !universoAcotado(filtros);

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
 * Puntaje de relevancia para el orden `relevancia`. Por término, pesa DÓNDE
 * aparece: en el nombre exhibido 4, en el código 3, en la marca o categoría
 * 2, en otro lado (descripción) 1. Encima: código exacto +20 (quien pega un
 * código quiere ESE producto) y nombre que empieza con el primer término +2.
 * En la búsqueda tolerante se suma el parecido de cada término con el nombre.
 */
function relevanciaSql(q: string, tolerante: boolean) {
  const terminos = terminosBusqueda(q);
  const nombre = sinTildes(nombreExhibidoSql);
  const codigo = sinTildes(crmCatalogo.code);
  const marcaCategoria = sinTildes(sql`concat_ws(' ', ${marcaSql}, ${crmCategoriasAlegra.name})`);
  const partes = terminos.map(
    (t) =>
      sql`(case when ${contiene(nombre, t)} then 4 when ${contiene(codigo, t)} then 3 when ${contiene(marcaCategoria, t)} then 2 else 1 end)`,
  );
  partes.push(sql`(case when ${codigo} = ${terminos.join(" ")} then 20 else 0 end)`);
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
  idPriceList?: string;
  /** "$X con <Medio>" (ver `mapFilaToProduct`). */
  mediosPrecio?: MediosPrecio;
  limit?: number;
  offset?: number;
  busqueda?: string;
  /** Segundo intento con parecido por trigramas (ver `coincideTexto`). */
  tolerante?: boolean;
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
  const q = opts.busqueda?.trim();
  const conTerminos = terminosBusqueda(q).length > 0;

  let query = getDb()
    .select(columnasCatalogo(opts.disp, opts.atributosEstructurados))
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(
      and(
        enTenantCatalogo(),
        activoSql,
        conPrecioSql,
        soloVisiblesSql(opts.soloVisibles),
        visibleEnZonaSql(opts.disp),
        q ? coincideTexto(q, opts.tolerante) : undefined
      )
    )
    // Con búsqueda (el autocomplete), lo más relevante primero.
    .orderBy(
      ...(q && conTerminos
        ? [sql`${relevanciaSql(q, !!opts.tolerante)} desc`, asc(crmCatalogo.name)]
        : [asc(crmCatalogo.name)]),
    )
    .$dynamic();

  if (opts.limit != null) query = query.limit(opts.limit);
  if (opts.offset != null) query = query.offset(opts.offset);

  const filas = await query;
  return filas.map((f) => mapFilaToProduct(f, opts.idPriceList, undefined, undefined, opts.mediosPrecio));
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

  const filas = await getDb()
    .select(columnasCatalogo(opts.disp))
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(
      and(
        enTenantCatalogo(),
        activoSql,
        conPrecioSql,
        soloVisiblesSql(opts.soloVisibles),
        visibleEnZonaSql(opts.disp),
        eq(crmOverlay.categoriaId, opts.categoriaId),
        conStock(opts.disp),
      ),
    )
    .orderBy(asc(crmCatalogo.name))
    .limit(opts.limit);

  return { nombre: categoria.nombre, productos: filas.map((f) => mapFilaToProduct(f, undefined, undefined, undefined, opts.mediosPrecio)) };
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
    /** Con `soloActivos`, también excluye lo oculto en todas las sucursales que sirven al visitante. */
    disp?: ContextoDisponibilidad;
    /** Sumar los atributos estructurados (sólo con la tabla disponible). */
    atributosEstructurados?: boolean;
    /** "$X con <Medio>" (ver `mapFilaToProduct`). */
    mediosPrecio?: MediosPrecio;
  },
): Promise<Map<string, Product>> {
  if (alegraIds.length === 0) return new Map();

  const filas = await getDb()
    .select(columnasCatalogo(opts?.disp, opts?.atributosEstructurados))
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(
      and(
        enTenantCatalogo(),
        inArray(crmCatalogo.alegraId, [...alegraIds]),
        opts?.soloActivos ? activoSql : undefined,
        opts?.soloActivos ? soloVisiblesSql(opts.soloVisibles ?? false) : undefined,
        opts?.soloActivos ? visibleEnZonaSql(opts.disp) : undefined,
      ),
    );

  return new Map(
    filas.map((f) => [f.alegraId, mapFilaToProduct(f, opts?.idPriceList, undefined, undefined, opts?.mediosPrecio)]),
  );
}

/**
 * Precio especial de la cuenta (ver `precio-cuenta.ts`) de cada id que lo
 * tenga. Los ids sin lista propia más barata no aparecen. Sin filtros de
 * visibilidad: sólo pisa precios de productos que el visitante ya está viendo.
 */
export async function preciosCuentaPorIds(
  alegraIds: readonly string[],
  idPriceList: string,
): Promise<Record<string, PrecioCuenta>> {
  if (alegraIds.length === 0) return {};
  const filas = await getDb()
    .select({
      alegraId: crmCatalogo.alegraId,
      prices: preciosSql,
      ivaPorcentaje: crmCatalogo.ivaPorcentaje,
    })
    .from(crmCatalogo)
    .where(and(enTenantCatalogo(), inArray(crmCatalogo.alegraId, [...alegraIds])));

  const out: Record<string, PrecioCuenta> = {};
  for (const f of filas) {
    const iva = f.ivaPorcentaje != null ? Number(f.ivaPorcentaje) : null;
    const p = precioCuenta(mapPrecios(f.prices), iva, idPriceList);
    if (p) out[f.alegraId] = p;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Catálogo paginado (filtros, orden y conteo en el servidor)
// ---------------------------------------------------------------------------

/** Cuántos productos entran en una página del catálogo. Múltiplo de la grilla (1/2/3 columnas). */
export const PRODUCTOS_POR_PAGINA = 24;

/**
 * El texto de una búsqueda, ya decidido por quien la pide (el motor, `busqueda-v2/motor.ts`):
 * una sola forma en lugar de `busqueda` + `busquedaTolerante` + `planBusqueda` (que se retiran
 * cuando todo pase por el motor).
 */
export interface TextoBusqueda {
  /** La consulta (recortada). Puede ser "" si sólo hay plan. */
  q: string;
  /** Con plan: recupera por OR y ordena con el puntaje del plan; sin plan, AND de LIKE. */
  plan?: CriterioPlan;
  /** Suma el parecido por trigramas por término de 4 letras o más. */
  tolerante?: boolean;
  /** Reservado: coincidencia por código normalizado, sin separadores. Todavía no hace nada. */
  codigo?: boolean;
}

/** Filtros que aplica el servidor. Categorías y marcas son OR dentro del grupo. */
export interface FiltrosCatalogo {
  /**
   * El texto de la búsqueda (ver `TextoBusqueda`). Gana sobre `busqueda`, `busquedaTolerante` y
   * `planBusqueda`, que siguen valiendo mientras migran los llamadores.
   */
  texto?: TextoBusqueda;
  busqueda?: string;
  /**
   * Segundo intento de la búsqueda, tolerante a errores de tipeo (ver
   * `coincideTexto`). Lo decide la page cuando la exacta no trajo nada, y va
   * en los MISMOS filtros de la página y de las facetas: así cuentan el
   * mismo conjunto que se ve.
   */
  busquedaTolerante?: boolean;
  categorias?: string[];
  marcas?: string[];
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
   * Sólo facetas: no calcular la de atributos (flag `busqueda-ia` apagado: el
   * panel queda como siempre y no se paga esa consulta). Sale `atributos: []`.
   */
  sinFacetaAtributos?: boolean;
  /**
   * `public.catalog_atributos` se puede leer (flag `busqueda-ia` + tabla disponible, lo decide la
   * page con `atributosEstructuradosDisponibles`). Con él, `atributos` mira primero el dato
   * estructurado, hay filtro y faceta de potencia, y los productos traen sus características.
   * Sin él, todo como en la fase 1 (y `potenciaMin`/`potenciaMax` se ignoran).
   */
  atributosEstructurados?: boolean;
  /** Extremos inclusivos de la potencia en watts (sólo productos con `potencia_w`). */
  potenciaMin?: number;
  potenciaMax?: number;
  /** Extremos inclusivos del rango, sobre el precio exhibido (con IVA). */
  precioMin?: number;
  precioMax?: number;
  /** Sólo productos con disponibilidad (ver `condicionesDe`). */
  soloStock?: boolean;
  /**
   * Búsqueda v2 (`?ia=1`, flag `busqueda-ia`): lo blando del plan. Con él, el texto ya no filtra
   * con AND: recupera candidatos (OR de términos, categorías y atributos blandos, ver
   * busqueda-v2/recuperar.ts) y `relevancia` ordena con el puntaje del plan (busqueda-v2/ordenar.ts).
   * Los duros viajan como siempre en `categorias` y `atributos`.
   */
  planBusqueda?: CriterioPlan;
}

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

/**
 * El texto efectivo de unos filtros: `texto` si viene; si no, lo que dicen los campos viejos
 * (`busqueda` recortada, `busquedaTolerante`, `planBusqueda`). Siempre un objeto: sin texto, `q` es "".
 */
export function textoDe(f: Pick<FiltrosCatalogo, "texto" | "busqueda" | "busquedaTolerante" | "planBusqueda">): TextoBusqueda {
  if (f.texto) return { ...f.texto, q: f.texto.q.trim() };
  return { q: f.busqueda?.trim() ?? "", tolerante: f.busquedaTolerante, plan: f.planBusqueda };
}

/**
 * Marca efectiva del producto, en SQL. Tiene que replicar el fallback de
 * `mapFilaToProduct`: si el customField de Alegra vino vacío, la marca que se
 * exhibe (y por la que se filtra) es el nombre de la categoría; con
 * `mostrar_marca = false` en el overlay no hay marca. Requiere el join al overlay.
 */
const marcaSql = sql<string>`(case when ${crmOverlay.mostrarMarca} is false then null
  else coalesce(nullif(${crmCatalogo.brand}, ''), ${crmCategoriasAlegra.name}) end)`;

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
export const conStock = (disp?: ContextoDisponibilidad) => {
  const stock = disp ? stockSucursalSql(disp) : stockSql;
  return sql`(${stock} is null or ${stock} > 0)`;
};

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
async function conteoPorCategoriaPropia(where: ReturnType<typeof condicionesDe>) {
  const filas = await getDb()
    .select({ id: crmOverlay.categoriaId, count: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(and(where, sql`${crmOverlay.categoriaId} is not null`))
    .groupBy(crmOverlay.categoriaId);
  return new Map(filas.map((f) => [f.id as string, Number(f.count)]));
}

/** Qué grupos de filtros entran en un WHERE (ver `condicionesDe`). */
interface AplicarFiltros {
  categorias: boolean;
  marcas: boolean;
  atributos: boolean;
  precio: boolean;
  potencia: boolean;
  stock: boolean;
}

const APLICAR_TODOS: AplicarFiltros = {
  categorias: true,
  marcas: true,
  atributos: true,
  precio: true,
  potencia: true,
  stock: true,
};

/**
 * Condición de texto cuando el plan no trae nada que recupere: con filtros duros, ninguna (las
 * palabras eran contexto: "luz cálida para el living" son las lámparas cálidas); sin ellos,
 * cualquiera de sus términos aunque sean de contexto (`condicionAmplia`). Sin plan, la clásica.
 */
function textoSinPlan(filtros: FiltrosCatalogo, texto: TextoBusqueda, disp?: ContextoDisponibilidad) {
  if (texto.plan) {
    if (filtros.categorias?.length || filtros.atributos?.length) return undefined;
    const amplia = condicionAmplia(texto.plan, piezasBusqueda(filtros, disp));
    if (amplia) return amplia;
  }
  return texto.q ? coincideTexto(texto.q, texto.tolerante) : undefined;
}

/**
 * Piezas SQL del catálogo para la búsqueda v2 (busqueda-v2/piezas.ts): el texto buscable, dónde
 * pesa un término, categorías con su subárbol, atributos y stock del contexto de sucursal.
 */
function piezasBusqueda(filtros: FiltrosCatalogo, disp?: ContextoDisponibilidad): PiezasBusqueda {
  const ctx = contextoAtributos(filtros);
  return {
    texto: textoBuscableSql(),
    nombre: sinTildes(nombreExhibidoSql),
    codigo: sinTildes(crmCatalogo.code),
    marcaCategoria: sinTildes(sql`concat_ws(' ', ${marcaSql}, ${crmCategoriasAlegra.name})`),
    enCategorias: filtroCategoriasSql,
    cumpleAtributo: (id) => cumpleAtributoSql(ctx, id),
    conStock: conStock(disp),
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
  disp?: ContextoDisponibilidad,
) {
  const texto = textoDe(filtros);
  // Con plan (búsqueda v2) el texto recupera en vez de filtrar; sin nada que recupere, la clásica.
  const recuperar = texto.plan ? condicionRecuperar(texto.plan, piezasBusqueda(filtros, disp)) : undefined;
  return and(
    enTenantCatalogo(),
    activoSql,
    conPrecioSql,
    soloVisiblesSql(soloVisibles),
    visibleEnZonaSql(disp),
    recuperar ?? textoSinPlan(filtros, texto, disp),
    aplicar.categorias && filtros.categorias?.length
      ? filtroCategoriasSql(filtros.categorias)
      : undefined,
    aplicar.marcas && filtros.marcas?.length
      ? inArray(marcaSql, filtros.marcas)
      : undefined,
    aplicar.atributos ? filtroAtributosSql(contextoAtributos(filtros), filtros.atributos) : undefined,
    aplicar.atributos ? filtroConClavesSql(filtros) : undefined,
    aplicar.potencia && filtros.atributosEstructurados
      ? filtroPotenciaSql(filtros.potenciaMin, filtros.potenciaMax)
      : undefined,
    aplicar.precio && filtros.precioMin != null
      ? sql`${precioExhibidoSql} >= ${filtros.precioMin}`
      : undefined,
    aplicar.precio && filtros.precioMax != null
      ? sql`${precioExhibidoSql} <= ${filtros.precioMax}`
      : undefined,
    aplicar.stock && filtros.soloStock ? conStock(disp) : undefined,
  );
}

/**
 * ORDER BY según el criterio elegido. El default (`nombre`) es el alfabético.
 * El desempate por nombre mantiene la paginación estable (sin él, dos productos
 * del mismo precio pueden intercambiarse entre páginas).
 */
function ordenDe(orden: OrdenCatalogo, filtros: FiltrosCatalogo, disp?: ContextoDisponibilidad) {
  switch (orden) {
    case "relevancia": {
      // Búsqueda v2: el puntaje del plan, aunque no quede texto filtrando.
      const texto = textoDe(filtros);
      if (texto.plan) {
        return [sql`${puntajeBusqueda(texto.plan, piezasBusqueda(filtros, disp))} desc`, asc(crmCatalogo.name)];
      }
      // Sin términos útiles no hay con qué puntuar: alfabético.
      if (!texto.q || !terminosBusqueda(texto.q).length) return [asc(crmCatalogo.name)];
      return [sql`${relevanciaSql(texto.q, !!texto.tolerante)} desc`, asc(crmCatalogo.name)];
    }
    case "precio-asc":
      return [sql`${precioExhibidoSql} asc`, asc(crmCatalogo.name)];
    case "precio-desc":
      return [sql`${precioExhibidoSql} desc`, asc(crmCatalogo.name)];
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
  const filtros = opts.filtros ?? {};
  const porPagina = opts.porPagina ?? PRODUCTOS_POR_PAGINA;
  const where = condicionesDe(filtros, APLICAR_TODOS, opts.soloVisibles, opts.disp);

  const [conteo] = opts.sinConteo
    ? []
    : await getDb()
        .select({ total: sql<number>`count(*)::int` })
        .from(crmCatalogo)
        .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
        .leftJoin(crmOverlay, joinOverlay())
        .leftJoin(stockReservado, joinReserva())
        .where(where);

  const total = conteo?.total ?? 0;
  const paginas = Math.max(Math.ceil(total / porPagina), 1);
  const pagina = opts.sinConteo ? 1 : acotarPagina(opts.pagina ?? 1, paginas);

  const filas = total || opts.sinConteo
    ? await getDb()
        .select(columnasCatalogo(opts.disp, filtros.atributosEstructurados))
        .from(crmCatalogo)
        .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
        .leftJoin(crmOverlay, joinOverlay())
        .leftJoin(stockReservado, joinReserva())
        .where(where)
        .orderBy(...ordenDe(opts.orden ?? ORDEN_DEFAULT, filtros, opts.disp))
        .limit(porPagina)
        .offset((pagina - 1) * porPagina)
    : [];

  const productos = filas.map((f) => mapFilaToProduct(f, opts.idPriceList, undefined, undefined, opts.mediosPrecio));
  if (opts.sinConteo) return { productos, total: productos.length, pagina: 1, paginas: 1, totalExacto: false };
  return { productos, total, pagina, paginas, totalExacto: true };
}

/**
 * Sólo el conteo de productos que cumplen los filtros (sin traer filas). Lo usa la búsqueda v2
 * para decidir si un filtro duro deja resultados antes de aplicarlo.
 */
export async function contarCatalogo(opts: {
  soloVisibles: boolean;
  filtros: FiltrosCatalogo;
  disp?: ContextoDisponibilidad;
}): Promise<number> {
  const [conteo] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(condicionesDe(opts.filtros, APLICAR_TODOS, opts.soloVisibles, opts.disp));
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
    idPriceList?: string;
    /** Flag `disponibilidad-sucursal`: null si ninguna sucursal que sirve al visitante lo ofrece. */
    disp?: ContextoDisponibilidad;
    /** Sumar características estructuradas (flag `busqueda-ia` + tabla disponible). */
    atributosEstructurados?: boolean;
    /** "$X con <Medio>" (ver `mapFilaToProduct`). */
    mediosPrecio?: MediosPrecio;
  },
): Promise<Product | null> {
  // Un id que no es de Alegra no es un producto: ni se consulta.
  if (!esIdAlegra(id)) return null;
  const productos = await getProductosPorIds([id], {
    idPriceList: opts.idPriceList,
    soloActivos: true,
    soloVisibles: opts.soloVisibles,
    disp: opts.disp,
    atributosEstructurados: opts.atributosEstructurados,
    mediosPrecio: opts.mediosPrecio,
  });
  return productos.get(id) ?? null;
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
   * Rango real de potencia (W) de los productos filtrados que TIENEN `potencia_w`, sin el propio
   * filtro de potencia. null = ninguno la tiene; ausente = no se calculó (sin estructurados).
   */
  potencia?: RangoPrecio | null;
  /**
   * Locales para el filtro "Con stock en <local>" (activos y con retiro). No salen de Postgres: los
   * agrega la page del catálogo cuando hay más de uno. Ausente = el filtro no se muestra.
   */
  locales?: { slug: string; nombre: string }[];
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
) {
  // Con estructurados, el jsonb de cada producto también se lee UNA vez por fila.
  const filas = getDb()
    .select({
      texto: sql<string>`${textoBuscableSql()}`.as("texto"),
      ...(estructurados ? { attrs: sql<unknown>`${atributosFilaSql()}`.as("attrs") } : {}),
    })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(where)
    .as("filas_atributos");
  const ctx: ContextoAtributos = estructurados
    ? { texto: sql`${filas.texto}`, attrs: sql`"filas_atributos"."attrs"`, medidaPositiva }
    : { texto: sql`${filas.texto}`, medidaPositiva };
  return getDb().select(columnasConteoAtributos(ctx, atributos)).from(filas);
}

/** Rango real de potencia (enteros hacia afuera) sobre los productos que tienen `potencia_w`. */
function consultaRangoPotencia(where: ReturnType<typeof condicionesDe>) {
  const potencia = potenciaSql();
  return getDb()
    .select({
      min: sql<number | null>`floor(min(${potencia}))::int`,
      max: sql<number | null>`ceil(max(${potencia}))::int`,
    })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(and(where, sql`${potencia} is not null`));
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
export async function getFacetas(
  filtros: FiltrosCatalogo,
  /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
  soloVisibles: boolean,
  /** Flag `disponibilidad-sucursal` (ver `ContextoDisponibilidad`). */
  disp?: ContextoDisponibilidad,
): Promise<Facetas> {
  const whereCategorias = condicionesDe(filtros, { ...APLICAR_TODOS, categorias: false }, soloVisibles, disp);
  const whereMarcas = condicionesDe(filtros, { ...APLICAR_TODOS, marcas: false }, soloVisibles, disp);
  const wherePrecio = condicionesDe(filtros, { ...APLICAR_TODOS, precio: false }, soloVisibles, disp);
  const whereAtributos = condicionesDe(filtros, { ...APLICAR_TODOS, atributos: false }, soloVisibles, disp);
  // Potencia: sólo con estructurados y con el panel de características (flag `busqueda-ia`).
  const conPotencia = Boolean(filtros.atributosEstructurados) && !filtros.sinFacetaAtributos;
  const wherePotencia = conPotencia
    ? condicionesDe(filtros, { ...APLICAR_TODOS, potencia: false }, soloVisibles, disp)
    : undefined;

  const arbol = await getArbolCategorias();

  const [categorias, marcas, [rango], [conteoAtributos], rangoPotencia] = await Promise.all([
    arbol.length
      ? Promise.all([
          conteoPorCategoriaPropia(condicionesDe({}, APLICAR_TODOS, soloVisibles, disp)),
          conteoPorCategoriaPropia(whereCategorias),
        ]).then(([base, filtrado]) => arbolCompletoConConteo(arbol, base, filtrado))
      : getDb()
      .select({
        label: sql<string>`${crmCategoriasAlegra.name}`,
        count: sql<number>`count(*)::int`,
      })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay())
      .leftJoin(stockReservado, joinReserva())
      .where(and(whereCategorias, sql`nullif(${crmCategoriasAlegra.name}, '') is not null`))
      .groupBy(crmCategoriasAlegra.name)
      .orderBy(sql`count(*) desc`, asc(crmCategoriasAlegra.name)),
    getDb()
      .select({ label: marcaSql, count: sql<number>`count(*)::int` })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay())
      .leftJoin(stockReservado, joinReserva())
      .where(and(whereMarcas, sql`nullif(${marcaSql}, '') is not null`))
      .groupBy(marcaSql)
      .orderBy(sql`count(*) desc`, sql`${marcaSql} asc`),
    // Enteros hacia afuera (floor/ceil) para que ningún producto quede fuera
    // de los límites que muestra el slider.
    getDb()
      .select({
        min: sql<number | null>`floor(min(${precioExhibidoSql}))::int`,
        max: sql<number | null>`ceil(max(${precioExhibidoSql}))::int`,
      })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay())
      .leftJoin(stockReservado, joinReserva())
      .where(wherePrecio),
    filtros.sinFacetaAtributos
      ? Promise.resolve([])
      : consultaConteoAtributos(whereAtributos, filtros.atributos, filtros.atributosEstructurados, medidasPositivasDe(filtros)),
    conPotencia ? consultaRangoPotencia(wherePotencia).then(([r]) => r) : Promise.resolve(undefined),
  ]);

  const precio =
    rango?.min != null && rango?.max != null
      ? { min: rango.min, max: rango.max }
      : null;

  const potencia = conPotencia
    ? rangoPotencia?.min != null && rangoPotencia?.max != null
      ? { min: rangoPotencia.min, max: rangoPotencia.max }
      : null
    : undefined;

  return {
    categorias,
    marcas,
    atributos: facetasDeConteos(conteoAtributos),
    precio,
    ...(potencia !== undefined ? { potencia } : {}),
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
 */
export const getCategorias = cache(async function getCategorias(
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
): Promise<string[]> {
  // Con árbol propio el menú muestra sus raíces, en el orden del CRM, contando
  // lo que se publica de verdad (mismo WHERE que la grilla sin filtros).
  const arbol = await getArbolCategorias();
  if (arbol.length) {
    const conteos = await conteoPorCategoriaPropia(condicionesDe({}, APLICAR_TODOS, soloVisibles, disp));
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

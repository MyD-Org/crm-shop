/**
 * Stock por sucursal en SQL y lectura de la disponibilidad (change `sucursales-igz-mdp`, rebanada
 * B, detrás del flag `disponibilidad-sucursal`). SOLO servidor.
 *
 * Fuente del stock de una sucursal: `public.catalog_stock_sucursal` (stock BRUTO de la cuenta de
 * esa sucursal) menos `shop.stock_reservado_sucursal` (lo apartado por pedidos vivos del Shop).
 * Producto SIN ninguna fila por sucursal (todavía no lo sincronizó el CRM): el stock de la vista
 * `catalog_products_shop` (un solo stock, el de la cuenta de origen) se asigna a
 * `ctx.stockHeredado` (la primera sucursal activa por `orden`) y las demás valen 0. Es el respaldo
 * de la transición: cuando la sync llena `catalog_stock_sucursal`, deja de aplicar por sí solo.
 * `stock` NULL en la vista = no inventariable: siempre disponible, con o sin filas.
 *
 * Con el flag apagado NADA de esto se usa: `stock-disponible.ts` (vista 0012, un solo stock) sigue
 * igual.
 *
 * Las expresiones exigen `from(crmCatalogo)` con `enTenantCatalogo()` y el join al overlay
 * (`joinOverlay()`, todas las consultas del catálogo lo tienen): el ocultamiento por sucursal sale
 * de `catalog_overlay.oculto_en_sucursales`.
 */
import { sql, type SQL } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { stockReservado, stockReservadoSucursal } from "@/db/schema";
import { joinReserva } from "./stock-disponible";
import { crmCatalogo, crmOverlay, crmStockSucursal } from "@/db/crm";
import { enTenantCatalogo } from "./catalogo-fuente";
import { joinOverlay } from "./nombre-exhibido";
import { shopTenantId } from "./tenant";
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";
import {
  armarStockPorSucursal,
  disponibilidadPorSucursal,
  type ResultadoDisponibilidad,
  type StockPorSucursal,
} from "./sucursales-disponibilidad";
import type { ReglasVenta, SucursalDato } from "./sucursales";

const arreglo = (slugs: string[]) =>
  sql`ARRAY[${sql.join(
    slugs.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;

/** Slugs donde el producto está oculto; sin fila de overlay = vacío. */
const ocultoEnSql = sql`coalesce(${crmOverlay.ocultoEnSucursales}, '{}'::text[])`;

/**
 * Disponible neto del producto en UNA sucursal, o NULL si ahí está oculto (no cuenta). Stock: la
 * fila de `catalog_stock_sucursal` (búsqueda por la PK); sin fila, el de la vista si es la sucursal
 * que hereda y el producto no tiene NINGUNA fila (respaldo de la transición), y si no 0. Menos lo
 * reservado ahí. Nunca negativo.
 *
 * Costo (EXPLAIN en prod, oct-2026): la versión anterior unía por fila la vista
 * `stock_reservado_sucursal` (un GROUP BY sobre los pedidos, re-ejecutado por producto y por
 * sucursal: crece con los pedidos) y el respaldo era un NOT EXISTS sin índice (recorre la tabla
 * entera por producto cuando se ejecuta). Ahora las dos cosas se calculan UNA vez por consulta:
 * - lo reservado: un jsonb `{alegra_id: qty}` por sucursal, subconsulta sin correlación (InitPlan);
 * - "sin ninguna fila": `NOT IN` contra los ids del tenant, que Postgres resuelve con un hash
 *   (`alegra_id` es NOT NULL en las dos tablas, así que NOT IN equivale a NOT EXISTS). Se evalúa
 *   sólo si falta la fila de la sucursal que hereda.
 * Supone lo reservado ≥ 0 (las líneas de pedido tienen cantidad positiva): sin fila de stock en
 * una sucursal que no hereda, el disponible es 0.
 */
function disponibleEnSucursalSql(slug: string, ctx: ContextoDisponibilidad, tenant: string) {
  const respaldo =
    slug === ctx.stockHeredado
      ? sql`case when ${crmCatalogo.alegraId} not in (
          select ${crmStockSucursal.alegraId} from ${crmStockSucursal} where ${crmStockSucursal.tenantId} = ${tenant}
        ) then ${crmCatalogo.stock} else 0 end`
      : sql`0`;
  return sql`case when ${slug} <> all(${ocultoEnSql}) then greatest(0,
      coalesce((
        select ${crmStockSucursal.stock} from ${crmStockSucursal}
        where ${crmStockSucursal.tenantId} = ${tenant} and ${crmStockSucursal.sucursal} = ${slug}
          and ${crmStockSucursal.alegraId} = ${crmCatalogo.alegraId}
      ), ${respaldo})
      - coalesce(((
        select jsonb_object_agg(${stockReservadoSucursal.alegraItemId}, ${stockReservadoSucursal.qty})
        from ${stockReservadoSucursal}
        where ${stockReservadoSucursal.tenantId} = ${tenant} and ${stockReservadoSucursal.sucursal} = ${slug}
      ) ->> ${crmCatalogo.alegraId})::numeric, 0)) end`;
}

/**
 * Disponible del producto para el contexto: el MEJOR disponible neto entre las sucursales que
 * cuentan (`ctx.contarEn`) donde el producto no está oculto (`greatest` ignora los NULL de las
 * ocultas). Una línea sale entera de UNA sucursal, así que el tope que se puede pedir es el máximo
 * y no la suma. `null` = no inventariable. Nunca negativo. Una expresión por fila, sin joins: sirve
 * en el SELECT (Postgres la calcula después del LIMIT, sólo para la página) y en la cotización.
 * Para FILTRAR u ordenar por el stock, `disponibleSucursalSql` (ver `joinStock`).
 */
export function stockSucursalSql(ctx: ContextoDisponibilidad) {
  const tenant = shopTenantId();
  const mejor = ctx.contarEn.length
    ? sql`coalesce(greatest(${sql.join(
        ctx.contarEn.map((slug) => disponibleEnSucursalSql(slug, ctx, tenant)),
        sql`, `,
      )}), 0)`
    : sql`0`;
  return sql<string | null>`(case when ${crmCatalogo.stock} is null then null else ${mejor} end)`.mapWith(
    crmCatalogo.stock,
  );
}

/** Alias del join lateral de `joinStock`. */
const ALIAS_STOCK = "stock_sucursal";

/**
 * El mismo disponible que `stockSucursalSql`, leído del join lateral de `joinStock` (la consulta
 * TIENE que hacer `.leftJoin(...joinStock(disp))`). Es lo que usan el filtro "con stock" y los
 * órdenes que dependen del stock.
 *
 * Por qué un join y no la expresión en el WHERE: la expresión hace búsquedas por fila y, puesta en
 * el WHERE, el planificador de Postgres la carga a cada vuelta del nested loop overlay → producto;
 * le salía más barato un hash join que recorre los ~18.000 productos del tenant (no los ~1.800
 * visibles), y además `(x is null or x > 0)` la calculaba dos veces. En un lateral se calcula UNA
 * vez por fila, después de los joins, y el plan vuelve al nested loop. Medido en prod: la página de
 * /catalogo con stock por sucursal bajó de ~106 a ~30 ms.
 */
export const disponibleSucursalSql = sql<string | null>`${sql.identifier(ALIAS_STOCK)}."disponible"`.mapWith(
  crmCatalogo.stock,
);

/**
 * El join del stock de toda consulta del catálogo (base `crmCatalogo`, después del join al
 * overlay): `.leftJoin(...joinStock(disp))`.
 * - Sin `disp`: la reserva de siempre (`shop.stock_reservado`, ver `stockSql`).
 * - Con `disp`: un `LEFT JOIN LATERAL` con el disponible por sucursal (`disponibleSucursalSql`).
 *   Es un agregado de una fila, así que si la consulta no lo usa (sin el filtro "con stock")
 *   Postgres lo elimina del plan y no cuesta nada.
 */
export function joinStock(disp?: ContextoDisponibilidad): [SQL, SQL] {
  if (!disp) return [sql`${stockReservado}`, joinReserva() ?? sql`true`];
  return [
    sql`lateral (select max(d.v) as "disponible" from (select ${stockSucursalSql(disp)} as v) d) ${sql.identifier(ALIAS_STOCK)}`,
    sql`true`,
  ];
}

/**
 * ¿Se muestra el producto a este visitante? Sí si alguna sucursal ACTIVA lo sirve (no está en
 * `oculto_en_sucursales`): la de su zona, o la otra (envío / "a traer"). En modalidad retiro, además
 * el local elegido no puede tenerlo oculto. Oculto en todas = no se muestra.
 */
export function visibleEnSucursalSql(ctx: ContextoDisponibilidad) {
  const servido = sql`not (${ocultoEnSql} @> ${arreglo(ctx.activas)})`;
  return ctx.local
    ? sql`(${servido} and not (${ctx.local} = any(${ocultoEnSql})))`
    : servido;
}

/** Transacción (o cliente) de drizzle: sólo `select`. */
type Lector = Pick<ReturnType<typeof getDb>, "select">;

/** Lo que devuelve la lectura de la disponibilidad bruta por ids. */
export interface DisponibilidadBruta {
  stockPorSucursal: StockPorSucursal;
  reservadoPorSucursal: Record<string, Record<string, number>>;
  ocultoEn: Record<string, string[]>;
}

/**
 * Lee, para `ids` (de este tenant), el stock bruto por sucursal, lo reservado por sucursal y el
 * ocultamiento por sucursal. Tres consultas chicas. Sirve para la ficha, el carrito y — dentro de
 * la transacción de `crearPedido`, después de los locks por ítem — la asignación de sucursal: por
 * eso recibe el ejecutor. Un id que no está en la vista no vuelve en `stockPorSucursal` (quien
 * llama lo trata como inexistente). Sin caché.
 */
export async function leerDisponibilidadBruta(
  ids: string[],
  sucursales: string[],
  stockHeredado: string,
  db: Lector = getDb(),
): Promise<DisponibilidadBruta> {
  if (ids.length === 0)
    return { stockPorSucursal: {}, reservadoPorSucursal: {}, ocultoEn: {} };
  const tenant = shopTenantId();
  const [productos, filas, reservas] = await Promise.all([
    db
      .select({
        alegraId: crmCatalogo.alegraId,
        stock: crmCatalogo.stock,
        oculto: crmOverlay.ocultoEnSucursales,
      })
      .from(crmCatalogo)
      .leftJoin(crmOverlay, joinOverlay())
      .where(and(enTenantCatalogo(), inArray(crmCatalogo.alegraId, ids))),
    db
      .select({
        alegraId: crmStockSucursal.alegraId,
        sucursal: crmStockSucursal.sucursal,
        stock: crmStockSucursal.stock,
      })
      .from(crmStockSucursal)
      .where(
        and(
          eq(crmStockSucursal.tenantId, tenant),
          inArray(crmStockSucursal.alegraId, ids),
        ),
      ),
    db
      .select({
        alegraId: stockReservadoSucursal.alegraItemId,
        sucursal: stockReservadoSucursal.sucursal,
        qty: stockReservadoSucursal.qty,
      })
      .from(stockReservadoSucursal)
      .where(
        and(
          eq(stockReservadoSucursal.tenantId, tenant),
          inArray(stockReservadoSucursal.alegraItemId, ids),
        ),
      ),
  ]);

  const stockPorSucursal = armarStockPorSucursal(
    productos.map((p) => ({
      alegraId: p.alegraId,
      stock: p.stock == null ? null : Number(p.stock),
    })),
    filas.map((f) => ({
      alegraId: f.alegraId,
      sucursal: f.sucursal,
      stock: Number(f.stock),
    })),
    sucursales,
    stockHeredado,
  );
  const reservadoPorSucursal: Record<string, Record<string, number>> = {};
  for (const r of reservas) {
    (reservadoPorSucursal[r.alegraId] ??= {})[r.sucursal] = Number(r.qty);
  }
  const ocultoEn: Record<string, string[]> = {};
  for (const p of productos)
    if (p.oculto?.length) ocultoEn[p.alegraId] = p.oculto;
  return { stockPorSucursal, reservadoPorSucursal, ocultoEn };
}

/**
 * Disponibilidad de productos por modalidad, para la ficha y el carrito. `zona` es la sucursal de
 * la zona vigente. Con "envio" calcula el envío (origen = la zona, con respaldo según las reglas);
 * con "retiro", un ítem por local; con "ambas", las dos (una sola lectura). Usa
 * `disponibilidadPorSucursal`, la misma regla que `asignarSucursal` al crear el pedido. Sin caché:
 * son pocos ids por vista.
 */
export async function disponibilidadDe(
  ids: string | string[],
  zona: string,
  modalidad: "envio" | "retiro" | "ambas",
  datos: {
    sucursales: SucursalDato[];
    reglas: ReglasVenta;
    cantidades?: Record<string, number>;
  },
): Promise<ResultadoDisponibilidad> {
  const lista = [...new Set(Array.isArray(ids) ? ids : [ids])];
  const activas = datos.sucursales
    .filter((s) => s.activa)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
    .map((s) => s.slug);
  if (activas.length === 0 || lista.length === 0)
    return { productos: {}, lineasATraer: [] };
  const bruta = await leerDisponibilidadBruta(lista, activas, activas[0]);
  const calcular = (m: "envio" | "retiro") =>
    disponibilidadPorSucursal({
      ...bruta,
      sucursales: datos.sucursales,
      zona,
      modalidad: m,
      reglas: datos.reglas,
      cantidades: datos.cantidades,
    });
  if (modalidad !== "ambas") return calcular(modalidad);
  const envio = calcular("envio");
  const retiro = calcular("retiro");
  return {
    lineasATraer: envio.lineasATraer,
    productos: Object.fromEntries(
      Object.entries(envio.productos).map(([id, p]) => [
        id,
        { ...p, retiro: retiro.productos[id]?.retiro ?? null },
      ]),
    ),
  };
}

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
import { sql } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { stockReservadoSucursal } from "@/db/schema";
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
 * Disponible del producto para el contexto: el MEJOR disponible neto entre las sucursales que
 * cuentan (`ctx.contarEn`) donde el producto no está oculto. Una línea sale entera de UNA
 * sucursal, así que el tope que se puede pedir es el máximo y no la suma. `null` = no
 * inventariable. Nunca negativo.
 */
export function stockSucursalSql(ctx: ContextoDisponibilidad) {
  const tenant = shopTenantId();
  return sql<
    string | null
  >`(case when ${crmCatalogo.stock} is null then null else coalesce((
    select max(greatest(0,
      coalesce(
        ${crmStockSucursal.stock},
        case when s.slug = ${ctx.stockHeredado} and not exists (
          select 1 from "public"."catalog_stock_sucursal" x
          where x.tenant_id = ${tenant} and x.alegra_id = ${crmCatalogo.alegraId}
        ) then ${crmCatalogo.stock} else 0 end
      ) - coalesce(${stockReservadoSucursal.qty}, 0)))
    from unnest(${arreglo(ctx.contarEn)}) as s(slug)
    left join ${crmStockSucursal}
      on ${crmStockSucursal.tenantId} = ${tenant}
      and ${crmStockSucursal.alegraId} = ${crmCatalogo.alegraId}
      and ${crmStockSucursal.sucursal} = s.slug
    left join ${stockReservadoSucursal}
      on ${stockReservadoSucursal.tenantId} = ${tenant}
      and ${stockReservadoSucursal.alegraItemId} = ${crmCatalogo.alegraId}
      and ${stockReservadoSucursal.sucursal} = s.slug
    where s.slug <> all(${ocultoEnSql})
  ), 0) end)`.mapWith(crmCatalogo.stock);
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

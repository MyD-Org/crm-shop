/**
 * De dónde lee el Shop su catálogo: las vistas del CRM
 * (`public.catalog_products_shop` y `public.catalog_categories_shop`, ver
 * `src/db/crm.ts`). Son de TODOS los tenants del CRM, así que:
 *
 * - toda consulta con base en `crmCatalogo` lleva `enTenantCatalogo()` en el
 *   WHERE: sin él se leerían los productos de otra empresa;
 * - el join a las categorías de Alegra lleva el tenant EN el ON
 *   (`joinCategoriasAlegra()`): es un left join, y un `alegra_id` de categoría
 *   puede repetirse entre tenants.
 *
 * `catalogo-tenant.test.ts` recorre cada función pública del catálogo y exige
 * las dos cosas. Funciones y no constantes: el tenant se lee del entorno en
 * cada consulta.
 *
 * SOLO servidor.
 */
import { and, eq, type SQL } from "drizzle-orm";
import { crmCatalogo, crmCategoriasAlegra } from "@/db/crm";
import { shopTenantId } from "./tenant";

/** WHERE obligatorio de toda consulta con base en la vista de productos. */
export const enTenantCatalogo = () => eq(crmCatalogo.tenantId, shopTenantId());

/** Left join producto → categoría de Alegra, con el tenant en el join. */
export const joinCategoriasAlegra = () =>
  and(
    eq(crmCategoriasAlegra.alegraId, crmCatalogo.categoryAlegraId),
    eq(crmCategoriasAlegra.tenantId, shopTenantId()),
  );

/**
 * Con el flag `variantes-selector` (`agrupar`), el listado muestra una sola card por modelo: el
 * representante del grupo (`es_representante`; true también en los productos sueltos). Se suma
 * con AND junto a `activoSql` SOLO en listado, conteo, facetas y destacados. NO va en la ficha, el
 * carrito, los favoritos ni la cotización: la variante pedida tiene que salir aunque no sea la
 * representante. Apagado devuelve `undefined` (drizzle lo ignora dentro de `and()`): el SQL es el de
 * antes. Obligatorio a propósito: un call site que lo olvide no compila.
 */
export const enListado = (agrupar: boolean): SQL | undefined =>
  agrupar ? eq(crmCatalogo.esRepresentante, true) : undefined;

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { cotizar } from "@/lib/cotizacion";
import { crearPedido, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import { campaniasActivasEn } from "@/lib/campanias/vigentes";
import { CuponCanjeError, leerPromocionCupon, type QuienCupon } from "@/lib/cupones/repo";
import { aplicarCupon } from "@/lib/cupones/reglas";
import type { PromocionCupon } from "@/lib/cupones/tipos";
import { assertLocalTestDb } from "./db-url";

/**
 * Crear un pedido con cupón (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md)
 * contra Postgres REAL (local, datos inventados): la foto del cupón, el unitario antes del cupón por
 * línea (sólo las alcanzadas), el canje en la misma transacción, el código agotado entre la
 * cotización y el pedido, y el reintento idempotente.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const GENERAL = "00000000-0000-4000-8000-0000000000a1";
const CAMPANIA = "00000000-0000-4000-8000-0000000000c1";
const REGLA = "00000000-0000-4000-8000-0000000000e1";
const PROMO = "00000000-0000-4000-8000-00000000c001";

const ana: QuienCupon = { clerkUserId: "user_ana", email: "ana@cliente.example", listaPrivada: false };
const beto: QuienCupon = { clerkUserId: "user_beto", email: "beto@cliente.example", listaPrivada: false };
const cliente = (q: QuienCupon): DatosCliente => ({ clerkUserId: q.clerkUserId!, email: q.email! });
const datos: DatosPedido = { contactoNombre: "Cliente", contactoTelefono: "1100000000", entregaTipo: "retiro", pagoMetodo: "transferencia" };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.cupon_canjes, shop.order_items, shop.orders, shop.carts restart identity cascade`);
  });
}

async function sembrar() {
  const db = getDb();
  await db.execute(sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`);
  const inicio = new Date(Date.now() - 3_600_000).toISOString();
  const fin = new Date(Date.now() + 86_400_000).toISOString();
  await db.execute(sql`insert into public.campanias (id, tenant_id, nombre, etiqueta, inicio, fin) values (${CAMPANIA}, ${TENANT}, 'Apertura', 'Apertura', ${inicio}::timestamptz, ${fin}::timestamptz)`);
  const precio = (p: number) => JSON.stringify([{ idPriceList: GENERAL, name: "General", price: p, main: true }]);
  await db.execute(sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online)
                       values (${TENANT}, 'N1', 'Normal', 50, 'active', 'active', 21, ${precio(1000)}::jsonb)`);
  const campanias = JSON.stringify([{ id: CAMPANIA, reglaId: REGLA, inicio, fin, pct: 20, unidades: null, precios: [{ idPriceList: GENERAL, price: 400 }] }]);
  await db.execute(sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online, campanias_online)
                       values (${TENANT}, 'C1', 'En campaña', 50, 'active', 'active', 21, ${precio(500)}::jsonb, ${campanias}::jsonb)`);
  await db.execute(sql`insert into public.cupon_promociones (id, tenant_id, nombre, tipo, pct, inicio, fin, prefijo, creado_por)
                       values (${PROMO}, ${TENANT}, 'Bot Instagram', 'unicos', 10, now() - interval '1 day', now() + interval '30 days', 'LUZ', 'test')`);
  await db.execute(sql`insert into public.cupon_codigos (promocion_id, tenant_id, codigo, origen) values (${PROMO}, ${TENANT}, 'LUZ-7KQ2M', 'integracion')`);
}

async function cotizarConCupon(p: PromocionCupon) {
  const c = await cotizar([{ id: "N1", qty: 1 }, { id: "C1", qty: 1 }], { campanias: await campaniasActivasEn(new Date()) });
  return aplicarCupon(c, p, {
    ahora: new Date(), opcion: { slug: "transferencia", forma: null, cuotasSinInteres: false },
    entrega: { tipo: "retiro", provincia: null }, totalListaGeneral: c.total, motivoCuenta: null, verificado: true, congelado: false,
  });
}

const contar = async (tabla: "shop.orders" | "shop.cupon_canjes") =>
  Number(((await getDb().execute(sql`select count(*)::int as n from ${sql.raw(tabla)}`)) as unknown as { n: number }[])[0].n);

beforeEach(async () => {
  await limpiar();
  await sembrar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("crearPedido con cupón", () => {
  it("congela la foto, el total con descuento y el unitario previo sólo en las líneas alcanzadas; reserva el canje", async () => {
    const promo = (await leerPromocionCupon("LUZ7KQ2M"))!;
    const c = await cotizarConCupon(promo);
    expect(c.cupon?.descuento).toBe(121);
    const { id } = await crearPedido(cliente(ana), { ...datos, cupon: { promo, quien: ana } }, c);
    const [o] = (await getDb().execute(sql`select total, cupon from shop.orders where id = ${id}`)) as unknown as { total: string; cupon: Record<string, unknown> }[];
    expect(Number(o.total)).toBe(c.total);
    expect(o.cupon).toMatchObject({ codigo: "LUZ-7KQ2M", promocionId: PROMO, pct: 10, descuento: 121 });
    const items = (await getDb().execute(sql`select alegra_item_id, precio_unitario, precio_sin_cupon from shop.order_items where order_id = ${id} order by alegra_item_id`)) as unknown as { alegra_item_id: string; precio_unitario: string; precio_sin_cupon: string | null }[];
    expect(items).toEqual([
      { alegra_item_id: "C1", precio_unitario: "400.00", precio_sin_cupon: null },
      { alegra_item_id: "N1", precio_unitario: "900.00", precio_sin_cupon: "1000.00" },
    ]);
    const [k] = (await getDb().execute(sql`select order_id, descuento_total from shop.cupon_canjes`)) as unknown as { order_id: string; descuento_total: string }[];
    expect(k).toEqual({ order_id: id, descuento_total: "121.00" });
  });

  it("código usado por otro pedido entre la cotización y el pedido: CuponCanjeError y no se crea nada", async () => {
    const promo = (await leerPromocionCupon("LUZ7KQ2M"))!;
    const c = await cotizarConCupon(promo);
    await crearPedido(cliente(beto), { ...datos, cupon: { promo, quien: beto } }, c);
    const err = await crearPedido(cliente(ana), { ...datos, cupon: { promo, quien: ana } }, c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CuponCanjeError);
    expect((err as CuponCanjeError).motivo).toBe("usado");
    expect(await contar("shop.orders")).toBe(1);
    expect(await contar("shop.cupon_canjes")).toBe(1);
  });

  it("reintento idempotente: el mismo pedido y un solo canje", async () => {
    const promo = (await leerPromocionCupon("LUZ7KQ2M"))!;
    const c = await cotizarConCupon(promo);
    const d = { ...datos, idempotencyKey: "clave-cupon-1", cupon: { promo, quien: ana } };
    const a = await crearPedido(cliente(ana), d, c);
    const b = await crearPedido(cliente(ana), d, c);
    expect(b).toMatchObject({ id: a.id, repetido: true });
    expect(await contar("shop.cupon_canjes")).toBe(1);
  });

  it("sin cupón: orders.cupon NULL y sin canje", async () => {
    const c = await cotizar([{ id: "N1", qty: 1 }], {});
    const { id } = await crearPedido(cliente(ana), datos, c);
    const [o] = (await getDb().execute(sql`select cupon from shop.orders where id = ${id}`)) as unknown as { cupon: unknown }[];
    expect(o.cupon).toBeNull();
    expect(await contar("shop.cupon_canjes")).toBe(0);
  });
});

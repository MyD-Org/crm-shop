import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { cotizar } from "@/lib/cotizacion";
import { cambiarMedioPedido, crearPedido, pedidoParaCambiarMedio, type DatosPedido } from "@/lib/pedidos";
import { leerPromocionCupon, motivoCuentaCupon, type QuienCupon } from "@/lib/cupones/repo";
import { aplicarCupon, cuponTrasRecotizar, promoDesdePedido } from "@/lib/cupones/reglas";
import type { PromocionCupon } from "@/lib/cupones/tipos";
import { assertLocalTestDb } from "./db-url";

/**
 * Recotizar un pedido con cupón al cambiar el medio (spec 2026-11-01-cupones-design.md, "Pedidos ya
 * creados") contra Postgres REAL (local, datos inventados): a una opción no elegible el pedido pierde el
 * cupón y libera el código; a una elegible lo conserva con el descuento de la lista nueva, aunque la
 * promoción se haya pausado.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const GENERAL = "00000000-0000-4000-8000-0000000000a1";
const OTRA = "00000000-0000-4000-8000-0000000000a2";
const PROMO = "00000000-0000-4000-8000-00000000c001";
const ana: QuienCupon = { clerkUserId: "user_ana", email: "ana@cliente.example", listaPrivada: false };
const dueno = { clerkUserId: "user_ana" };
const datos: DatosPedido = { contactoNombre: "Cliente", contactoTelefono: "1100000000", entregaTipo: "retiro", pagoMetodo: "transferencia" };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.cupon_canjes, shop.order_items, shop.orders, shop.carts restart identity cascade`);
  });
}

async function sembrar(medios: string[] | null) {
  const db = getDb();
  await db.execute(sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`);
  const precios = JSON.stringify([
    { idPriceList: GENERAL, name: "General", price: 1000, main: true },
    { idPriceList: OTRA, name: "Otra", price: 800, main: false },
  ]);
  await db.execute(sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online)
                       values (${TENANT}, 'N1', 'Normal', 50, 'active', 'active', 0, ${precios}::jsonb)`);
  await db.execute(sql`insert into public.cupon_promociones (id, tenant_id, nombre, tipo, pct, inicio, fin, prefijo, medios, creado_por)
                       values (${PROMO}, ${TENANT}, 'Transfer', 'unicos', 10, now() - interval '1 day', now() + interval '30 days', 'LUZ',
                               ${medios ? `{${medios.join(",")}}` : null}::text[], 'test')`);
  await db.execute(sql`insert into public.cupon_codigos (promocion_id, tenant_id, codigo, origen) values (${PROMO}, ${TENANT}, 'LUZ-7KQ2M', 'lote')`);
}

const ctx = (slug: string, congelado = false) => ({
  ahora: new Date(), opcion: { slug, forma: null, cuotasSinInteres: false }, entrega: { tipo: "retiro" as const, provincia: null },
  totalListaGeneral: 0, motivoCuenta: null, verificado: true, congelado,
});

async function crearConCupon(promo: PromocionCupon): Promise<string> {
  const c = aplicarCupon(await cotizar([{ id: "N1", qty: 1 }], {}), promo, ctx("transferencia"));
  return (await crearPedido({ clerkUserId: "user_ana", email: "ana@cliente.example" }, { ...datos, cupon: { promo, quien: ana } }, c)).id;
}

/** Lo que hace `/api/pedidos/:id/medio`: recotiza con la foto congelada y la opción nueva. */
async function cambiar(id: string, slug: string, idLista: string) {
  const pedido = (await pedidoParaCambiarMedio(id, dueno))!;
  const base = await cotizar(pedido.lineas, { idListaMedio: idLista, excluirPedidoId: id });
  const cot = pedido.cupon ? aplicarCupon(base, promoDesdePedido(pedido.cupon), ctx(slug, true)) : base;
  const r = await cambiarMedioPedido(id, dueno, { pagoMetodo: slug, cuotas: null, idPriceList: idLista, cotizacion: cot, cupon: cuponTrasRecotizar(pedido.cupon, cot) });
  expect(r.ok).toBe(true);
  return cot;
}

const leerPedido = async (id: string) =>
  ((await getDb().execute(sql`select total, cupon from shop.orders where id = ${id}`)) as unknown as { total: string; cupon: Record<string, unknown> | null }[])[0];
const preciosSinCupon = async (id: string) =>
  ((await getDb().execute(sql`select precio_sin_cupon from shop.order_items where order_id = ${id}`)) as unknown as { precio_sin_cupon: string | null }[]).map((f) => f.precio_sin_cupon);

beforeEach(limpiar);
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("cambio de medio de un pedido con cupón", () => {
  it("pedidoParaCambiarMedio devuelve la foto del cupón", async () => {
    await sembrar(null);
    const id = await crearConCupon((await leerPromocionCupon("LUZ7KQ2M"))!);
    expect((await pedidoParaCambiarMedio(id, dueno))?.cupon).toMatchObject({ codigo: "LUZ-7KQ2M", pct: 10, descuento: 100 });
  });

  it("a una opción no elegible: sin cupón, sin precio_sin_cupon y el código queda libre", async () => {
    await sembrar(["transferencia"]);
    const promo = (await leerPromocionCupon("LUZ7KQ2M"))!;
    const id = await crearConCupon(promo);
    await cambiar(id, "mercadopago", GENERAL);
    const o = await leerPedido(id);
    expect(o.cupon).toBeNull();
    expect(Number(o.total)).toBe(1000);
    expect(await preciosSinCupon(id)).toEqual([null]);
    expect(await motivoCuentaCupon(getDb(), promo, { ...ana, clerkUserId: "user_beto", email: "beto@cliente.example" })).toBeNull();
  });

  it("a otra opción elegible: conserva el cupón con el descuento de la lista nueva", async () => {
    await sembrar(null);
    const id = await crearConCupon((await leerPromocionCupon("LUZ7KQ2M"))!);
    await cambiar(id, "efectivo", OTRA);
    const o = await leerPedido(id);
    expect(o.cupon).toMatchObject({ codigo: "LUZ-7KQ2M", descuento: 80 });
    expect(Number(o.total)).toBe(720);
    expect(await preciosSinCupon(id)).toEqual(["800.00"]);
  });

  it("promoción pausada después de crear el pedido: el cambio a un medio elegible conserva el descuento", async () => {
    await sembrar(null);
    const id = await crearConCupon((await leerPromocionCupon("LUZ7KQ2M"))!);
    await getDb().execute(sql`update public.cupon_promociones set activa = false where id = ${PROMO}`);
    await cambiar(id, "efectivo", GENERAL);
    expect((await leerPedido(id)).cupon).toMatchObject({ descuento: 100 });
  });
});

describe("carrera entre dos cambios de medio", () => {
  it("una recotización con cupón vieja no le devuelve el descuento a un pedido que ya lo perdió", async () => {
    await sembrar(["transferencia"]);
    const id = await crearConCupon((await leerPromocionCupon("LUZ7KQ2M"))!);
    const leida = (await pedidoParaCambiarMedio(id, dueno))!;
    const conCupon = aplicarCupon(await cotizar(leida.lineas, { excluirPedidoId: id }), promoDesdePedido(leida.cupon!), ctx("transferencia", true));
    await cambiar(id, "mercadopago", GENERAL); // la otra pestaña: pierde el cupón y libera el canje
    const r = await cambiarMedioPedido(id, dueno, {
      pagoMetodo: "transferencia", cuotas: null, idPriceList: GENERAL, cotizacion: conCupon, cupon: cuponTrasRecotizar(leida.cupon, conCupon),
    });
    expect(r).toEqual({ ok: false, motivo: "lineas_distintas" });
    expect((await leerPedido(id)).cupon).toBeNull();
  });
});

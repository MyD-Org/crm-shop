import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { cambiarMedioPedido, crearPedido, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Cambiar el medio de pago de un pedido pendiente SOBRE EL MISMO pedido, contra Postgres real
 * (local, datos inventados): mismo id y número, sin pedidos nuevos, precios y totales recotizados,
 * bloqueos (cobro abierto, ya pagado, ajeno) y carrito del servidor.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente@cliente.example" };
const dueno = { clerkUserId: "user_1" };

const datos = (extra: Partial<DatosPedido> = {}): DatosPedido => ({
  contactoNombre: "Cliente de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "mercadopago",
  ...extra,
});

const linea = (precio: number): LineaCotizada => ({
  id: "item-1",
  code: "COD-1",
  name: "Producto 1",
  brand: "Marca",
  qty: 2,
  precioUnitario: precio,
  ivaPorcentaje: 21,
  subtotal: precio * 2,
  iva: Math.round(precio * 2 * 21) / 100,
  total: Math.round(precio * 2 * 121) / 100,
  stockDisponible: null,
});
const cot = (precio: number): Cotizacion => {
  const l = linea(precio);
  return { lineas: [l], subtotal: l.subtotal, iva: l.iva, costoEnvio: 0, total: l.total, hayProblemas: false, listaPrivada: false };
};

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(
      sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts restart identity cascade`,
    );
  });
}

async function sembrar() {
  const db = getDb();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  await db.execute(
    sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status) values (${TENANT}, 'item-1', 'Producto 1', 10, 'active')`,
  );
}

async function crear(extra: Partial<DatosPedido> = {}) {
  return crearPedido(cliente, datos(extra), cot(1000));
}

const cantidadPedidos = async () =>
  Number(((await getDb().execute(sql`select count(*)::int as n from shop.orders`)) as unknown as { n: number }[])[0].n);

async function fila(id: string) {
  const [f] = (await getDb().execute(
    sql`select o.pago_metodo, o.cuotas, o.subtotal, o.iva, o.total, o.id_price_list, o.reserva_vence_en, o.numero,
               i.precio_unitario, i.total as total_linea
        from shop.orders o join shop.order_items i on i.order_id = o.id where o.id = ${id}`,
  )) as unknown as Record<string, string | number | null>[];
  return f;
}

beforeEach(async () => {
  await limpiar();
  await sembrar();
});
afterAll(async () => {
  await limpiar();
});

describe("cambiarMedioPedido", () => {
  it("actualiza el MISMO pedido (id y número), recotiza líneas y totales y no crea otro", async () => {
    const p = await crear();
    const antes = await cantidadPedidos();
    const r = await cambiarMedioPedido(p.id, dueno, {
      pagoMetodo: "transferencia",
      cuotas: null,
      idPriceList: "lista-transf",
      cotizacion: cot(900),
    });
    expect(r).toMatchObject({ ok: true, id: p.id, numero: p.numero, total: 2178 });
    expect(await cantidadPedidos()).toBe(antes);
    const f = await fila(p.id);
    expect(f.pago_metodo).toBe("transferencia");
    expect(f.id_price_list).toBe("lista-transf");
    expect(Number(f.precio_unitario)).toBe(900);
    expect(Number(f.total_linea)).toBe(2178);
    expect(Number(f.total)).toBe(2178);
  });

  it("de tarjeta con cuotas a otra con cuotas: congela las cuotas nuevas", async () => {
    const p = await crear({ cuotas: 3 });
    await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "payway", cuotas: 6, idPriceList: "lista-6", cotizacion: cot(1100) });
    const f = await fila(p.id);
    expect(f.cuotas).toBe(6);
    expect(Number(f.total)).toBe(2662);
  });

  it("con un cobro abierto: no cambia nada (pago_en_curso)", async () => {
    const p = await crear();
    await getDb().execute(
      sql`insert into shop.pago_intentos (order_id, tenant_id, proveedor, estado) values (${p.id}, ${TENANT}, 'mercadopago', 'pendiente')`,
    );
    const r = await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "transferencia", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    expect(r).toEqual({ ok: false, motivo: "pago_en_curso" });
    expect((await fila(p.id)).pago_metodo).toBe("mercadopago");
  });

  it("con un cobro rechazado anterior sí cambia", async () => {
    const p = await crear();
    await getDb().execute(
      sql`insert into shop.pago_intentos (order_id, tenant_id, proveedor, estado) values (${p.id}, ${TENANT}, 'mercadopago', 'fallido')`,
    );
    await getDb().execute(sql`update shop.orders set pago_estado = 'fallido' where id = ${p.id}`);
    const r = await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "transferencia", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    expect(r.ok).toBe(true);
    const [e] = (await getDb().execute(sql`select pago_estado from shop.orders where id = ${p.id}`)) as unknown as { pago_estado: string }[];
    expect(e.pago_estado).toBe("pendiente");
  });

  it("ya pagado: no cambia", async () => {
    const p = await crear();
    await getDb().execute(sql`update shop.orders set pago_estado = 'pagado' where id = ${p.id}`);
    const r = await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "transferencia", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    expect(r).toEqual({ ok: false, motivo: "no_existe" });
  });

  it("pedido ajeno: no existe para el otro comprador", async () => {
    const p = await crear();
    const r = await cambiarMedioPedido(p.id, { clerkUserId: "user_2" }, { pagoMetodo: "transferencia", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    expect(r).toEqual({ ok: false, motivo: "no_existe" });
    expect((await fila(p.id)).pago_metodo).toBe("mercadopago");
  });

  it("un pedido sin cobro en línea que coordina el local no se cambia (no_cambia): el mail ya salió", async () => {
    const p = await crear({ pagoMetodo: "efectivo" });
    const r = await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "mercadopago", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    expect(r).toEqual({ ok: false, motivo: "no_cambia" });
    expect((await fila(p.id)).pago_metodo).toBe("efectivo");
  });

  it("desde la transferencia sin comprobante informado sí se cambia, sobre el mismo pedido", async () => {
    const p = await crear({ pagoMetodo: "transferencia" });
    const r = await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "mercadopago", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    expect(r).toMatchObject({ ok: true, id: p.id });
    expect((await fila(p.id)).pago_metodo).toBe("mercadopago");
  });

  it("líneas distintas a las del pedido: no cambia", async () => {
    const p = await crear();
    const c = cot(900);
    c.lineas[0].qty = 5;
    const r = await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "transferencia", cuotas: null, idPriceList: null, cotizacion: c });
    expect(r).toEqual({ ok: false, motivo: "lineas_distintas" });
  });

  it("a un medio sin cobro en línea vacía el carrito del servidor; a uno en línea no", async () => {
    const p = await crear();
    await getDb().execute(
      sql`insert into shop.carts (tenant_id, clerk_user_id, items) values (${TENANT}, 'user_1', '[{"id":"item-1","qty":2}]'::jsonb)`,
    );
    await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "payway", cuotas: null, idPriceList: null, cotizacion: cot(1100) });
    const n = async () =>
      Number(((await getDb().execute(sql`select count(*)::int as n from shop.carts where clerk_user_id = 'user_1'`)) as unknown as { n: number }[])[0].n);
    expect(await n()).toBe(1);
    await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "transferencia", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    const [c] = (await getDb().execute(sql`select items from shop.carts where clerk_user_id = 'user_1'`)) as unknown as { items: unknown[] }[];
    expect(!c || (Array.isArray(c.items) && c.items.length === 0)).toBe(true);
  });
});

// --- Forma de pago congelada (migración 0036, change `listas-por-forma-de-pago`, rebanada C) ---
const formaDe = async (id: string) =>
  ((await getDb().execute(sql`select forma_cobro, pago_revision from shop.orders where id = ${id}`)) as unknown as {
    forma_cobro: string | null;
    pago_revision: string | null;
  }[])[0];

describe("forma_cobro del pedido", () => {
  it("crearPedido congela la forma y la devuelve; sin forma queda NULL (pedido viejo)", async () => {
    const conForma = await crear({ formaCobro: "credito" });
    expect(conForma.formaCobro).toBe("credito");
    expect((await formaDe(conForma.id)).forma_cobro).toBe("credito");
    const sinForma = await crear();
    expect(sinForma.formaCobro).toBeNull();
    expect((await formaDe(sinForma.id)).forma_cobro).toBeNull();
  });

  it("cambiarMedioPedido recotiza y recongela total y forma_cobro (crédito -> débito)", async () => {
    const p = await crear({ formaCobro: "credito" });
    const r = await cambiarMedioPedido(p.id, dueno, {
      pagoMetodo: "mercadopago",
      cuotas: null,
      formaCobro: "debito",
      idPriceList: "lista-debito",
      cotizacion: cot(900),
    });
    expect(r).toMatchObject({ ok: true, id: p.id, total: 2178, formaCobro: "debito" });
    const f = await fila(p.id);
    expect(Number(f.total)).toBe(2178);
    expect(f.id_price_list).toBe("lista-debito");
    expect((await formaDe(p.id)).forma_cobro).toBe("debito");
  });

  it("cambiar a un medio sin precios por forma deja la forma en NULL", async () => {
    const p = await crear({ formaCobro: "debito" });
    await cambiarMedioPedido(p.id, dueno, { pagoMetodo: "transferencia", cuotas: null, idPriceList: null, cotizacion: cot(900) });
    expect((await formaDe(p.id)).forma_cobro).toBeNull();
  });

  it("un pedido con el pago en revisión no se recotiza: pago_en_revision y nada cambia", async () => {
    const p = await crear({ formaCobro: "credito" });
    await getDb().execute(sql`update shop.orders set pago_revision = 'forma_distinta' where id = ${p.id}`);
    const r = await cambiarMedioPedido(p.id, dueno, {
      pagoMetodo: "mercadopago",
      cuotas: null,
      formaCobro: "debito",
      idPriceList: null,
      cotizacion: cot(900),
    });
    expect(r).toEqual({ ok: false, motivo: "pago_en_revision" });
    expect((await formaDe(p.id)).forma_cobro).toBe("credito");
    expect(Number((await fila(p.id)).total)).toBe(2420);
  });

  it("el CHECK admite 'forma_distinta' y las tres formas, y rechaza otras", async () => {
    const p = await crear();
    for (const forma of ["credito", "debito", "cuenta_mp"]) {
      await getDb().execute(sql`update shop.orders set forma_cobro = ${forma} where id = ${p.id}`);
    }
    await getDb().execute(sql`update shop.orders set pago_revision = 'forma_distinta' where id = ${p.id}`);
    expect((await formaDe(p.id)).pago_revision).toBe("forma_distinta");
    await expect(getDb().execute(sql`update shop.orders set forma_cobro = 'efectivo' where id = ${p.id}`)).rejects.toThrow();
    await expect(getDb().execute(sql`update shop.orders set pago_revision = 'otra' where id = ${p.id}`)).rejects.toThrow();
  });
});

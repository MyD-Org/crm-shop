import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  crearPedido,
  pedidoParaReintentarPago,
  registrarCobro,
  reservarIntento,
  type DatosCliente,
  type DatosPedido,
} from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Reintento del pago de un pedido con el pago rechazado, contra Postgres REAL (local): se retoma el
 * mismo pedido (nunca se crea otro), sólo del dueño y sólo si sigue cobrable. Datos inventados.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente@cliente.example" };
const datos: DatosPedido = {
  contactoNombre: "Cliente de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "payway",
};
const linea: LineaCotizada = {
  id: "item-1",
  code: "COD-1",
  name: "Producto 1",
  brand: "Marca",
  qty: 1,
  precioUnitario: 1000,
  ivaPorcentaje: 21,
  subtotal: 1000,
  iva: 210,
  total: 1210,
  stockDisponible: null,
};
const cotizacion: Cotizacion = { lineas: [linea], subtotal: 1000, iva: 210, costoEnvio: 0, total: 1210, hayProblemas: false, listaPrivada: false };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(
      sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts, shop.pago_intentos restart identity cascade`,
    );
  });
}

beforeEach(async () => {
  await limpiar();
  await getDb().execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  await getDb().execute(
    sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status) values (${TENANT}, 'item-1', 'Producto 1', 10, 'active')`,
  );
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

async function contarPedidos() {
  const r = await getDb().execute(sql`select count(*)::int as n from shop.orders`);
  return Number((r as unknown as { n: number }[])[0].n);
}

async function pedidoRechazado() {
  const p = await crearPedido(cliente, datos, cotizacion);
  const r = await reservarIntento(p.id, "payway", "tarjeta");
  if (!r || !("intentoId" in r)) throw new Error("sin intento");
  await registrarCobro(p.id, { proveedor: "payway", referencia: "ref-1", estado: "fallido", detalle: "x" }, { intentoId: r.intentoId, avisar: false });
  return p.id;
}

const dueno = { clerkUserId: "user_1" };
const SLUGS = ["payway"];

describe("pedidoParaReintentarPago", () => {
  it("pedido con pago rechazado: devuelve el mismo, con su total y cuotas, y no crea otro", async () => {
    const id = await pedidoRechazado();
    const antes = await contarPedidos();
    const r = await pedidoParaReintentarPago(dueno, id, SLUGS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pedido.id).toBe(id);
      expect(r.pedido.total).toBe(1210);
    }
    expect(await contarPedidos()).toBe(antes);
  });

  it("pedido ajeno: no existe para quien lo pide", async () => {
    const id = await pedidoRechazado();
    expect(await pedidoParaReintentarPago({ clerkUserId: "user_2" }, id, SLUGS)).toEqual({ ok: false, motivo: "no_existe" });
    expect(await pedidoParaReintentarPago(dueno, "no-es-un-id", SLUGS)).toEqual({ ok: false, motivo: "no_existe" });
  });

  it("pedido pagado: no se reintenta", async () => {
    const id = await pedidoRechazado();
    await getDb().execute(sql`update shop.orders set pago_estado = 'pagado' where id = ${id}`);
    expect(await pedidoParaReintentarPago(dueno, id, SLUGS)).toEqual({ ok: false, motivo: "pagado" });
  });

  it("cancelado o vencido: no es cobrable", async () => {
    const id = await pedidoRechazado();
    const dia = 25 * 60 * 60_000;
    expect(await pedidoParaReintentarPago(dueno, id, SLUGS, Date.now() + dia)).toEqual({ ok: false, motivo: "no_cobrable" });
    await getDb().execute(sql`update shop.orders set estado = 'cancelado', cancelacion_motivo = 'prueba' where id = ${id}`);
    expect(await pedidoParaReintentarPago(dueno, id, SLUGS)).toEqual({ ok: false, motivo: "no_cobrable" });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { fijarReferenciaIntento } from "@/lib/pedidos";
import { leerCarrito } from "@/lib/carrito-db";
import {
  crearPedido,
  getPedidoParaPago,
  listarPedidos,
  pedidoPendienteMasReciente,
  registrarCobro,
  reservarIntento,
  type DatosCliente,
  type DatosPedido,
} from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Carrito tras un cobro en línea, contra Postgres REAL (local): cuando la ruta de cobro envía el pago
 * al procesador y éste lo deja pendiente, el carrito del servidor se vacía; el webhook, la conciliación
 * y la consulta del comprador (sin `intentoId`) no lo tocan. Datos inventados.
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

async function pedidoConCarrito() {
  const db = getDb();
  const p = await crearPedido(cliente, datos, cotizacion);
  await db.execute(
    sql`insert into shop.carts (tenant_id, clerk_user_id, items, version) values (${TENANT}, 'user_1', '[{"id":"item-1","qty":1}]'::jsonb, 3)`,
  );
  const r = await reservarIntento(p.id, "payway", "tarjeta", undefined, { cuenta: "igz", cuentaPrevista: "igz" });
  if (!r || !("intentoId" in r)) throw new Error("sin intento");
  return { pedidoId: p.id, intentoId: r.intentoId };
}

const cobro = (estado: "pendiente" | "pagado" | "fallido") => ({
  proveedor: "payway",
  referencia: "ref-1",
  estado,
  detalle: "x",
});

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

describe("carrito tras un cobro en línea pendiente", () => {
  it("la ruta de cobro (con intentoId) deja el pedido pendiente y vacía el carrito del servidor", async () => {
    const { pedidoId, intentoId } = await pedidoConCarrito();
    await registrarCobro(pedidoId, cobro("pendiente"), { intentoId });
    expect((await leerCarrito("user_1")).items).toEqual([]);
    expect((await getPedidoParaPago(pedidoId, { clerkUserId: "user_1" }))?.pagoEstado).toBe("pendiente");
  });

  it("un reintento (segundo intento) que vuelve a quedar pendiente NO borra el carrito nuevo", async () => {
    const { pedidoId, intentoId } = await pedidoConCarrito();
    await registrarCobro(pedidoId, cobro("fallido"), { intentoId, avisar: false });
    const r = await reservarIntento(pedidoId, "payway", "tarjeta", undefined, { cuenta: "igz", cuentaPrevista: "igz" });
    if (!r || !("intentoId" in r)) throw new Error("sin intento");
    await registrarCobro(pedidoId, { ...cobro("pendiente"), referencia: "ref-2" }, { intentoId: r.intentoId });
    expect((await leerCarrito("user_1")).items).toEqual([{ id: "item-1", qty: 1 }]);
  });

  it("la conciliación o la consulta del comprador (sin intentoId) no tocan el carrito", async () => {
    const { pedidoId } = await pedidoConCarrito();
    await registrarCobro(pedidoId, cobro("pendiente"));
    expect((await leerCarrito("user_1")).items).toEqual([{ id: "item-1", qty: 1 }]);
  });

  it("un rechazo de la ruta de cobro deja el carrito como estaba", async () => {
    const { pedidoId, intentoId } = await pedidoConCarrito();
    await registrarCobro(pedidoId, cobro("fallido"), { intentoId, avisar: false });
    expect((await leerCarrito("user_1")).items).toEqual([{ id: "item-1", qty: 1 }]);
  });

  it("si se aprueba, el carrito se vacía igual (comportamiento de siempre)", async () => {
    const { pedidoId } = await pedidoConCarrito();
    await registrarCobro(pedidoId, cobro("pagado"), { avisar: false });
    expect((await leerCarrito("user_1")).items).toEqual([]);
  });
});

describe("pago en curso (cobro ya enviado al procesador y sin resolver)", () => {
  it("un intento con referencia marca el pedido como en proceso, para el rescate y para Mi cuenta", async () => {
    const { pedidoId, intentoId } = await pedidoConCarrito();
    const dueno = { clerkUserId: "user_1" };

    // Reserva sin referencia: todavía no se envió nada.
    expect((await pedidoPendienteMasReciente(dueno, ["payway"]))?.pagoEnCurso).toBe(false);
    expect((await listarPedidos(dueno))[0].pagoEnProceso).toBeUndefined();

    await fijarReferenciaIntento(intentoId, "ref-1");
    expect((await pedidoPendienteMasReciente(dueno, ["payway"]))?.pagoEnCurso).toBe(true);
    expect((await listarPedidos(dueno))[0]).toMatchObject({ id: pedidoId, pagoEnProceso: true });

    // Rechazado: ya no está en proceso.
    await registrarCobro(pedidoId, cobro("fallido"), { avisar: false });
    expect((await listarPedidos(dueno))[0].pagoEnProceso).toBeUndefined();
  });
});

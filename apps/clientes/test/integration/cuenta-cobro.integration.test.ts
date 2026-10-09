import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  cerrarIntentoSinPago,
  crearPedido,
  cuentaDelIntentoPorReferencia,
  cuentasRechazadasDelPedido,
  detalleCredencialesRechazadas,
  fijarReferenciaIntento,
  intentoAbiertoDelPedido,
  intentosPendientesDeReconciliar,
  registrarCobro,
  registrarCuentaRechazada,
  reservarIntento,
  type DatosCliente,
  type DatosPedido,
} from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Cuenta de cobro congelada en el intento (migración 0035) y en `orders.pago_info`, contra Postgres REAL
 * (local). Evidencia de credenciales rechazadas en la base. Datos inventados.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente@cliente.example" };
const datos: DatosPedido = {
  contactoNombre: "Cliente de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "mercadopago",
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
const dueno = { clerkUserId: "user_1" };

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

async function filas(pedidoId: string) {
  return (await getDb().execute(
    sql`select cuenta, cuenta_prevista, estado, detalle, referencia from shop.pago_intentos where order_id = ${pedidoId} order by created_at`,
  )) as unknown as { cuenta: string | null; cuenta_prevista: string | null; estado: string; detalle: string | null; referencia: string | null }[];
}

async function pedidoDb(pedidoId: string) {
  const [f] = (await getDb().execute(
    sql`select pago_estado, pago_info from shop.orders where id = ${pedidoId}`,
  )) as unknown as { pago_estado: string; pago_info: Record<string, unknown> | null }[];
  return f;
}

async function reservar(pedidoId: string, cuenta: string, cuentaPrevista: string | null) {
  const r = await reservarIntento(pedidoId, "mercadopago", "tarjeta", undefined, { cuenta, cuentaPrevista });
  if (!r || !("intentoId" in r)) throw new Error("sin intento");
  return r.intentoId;
}

describe("cuenta congelada en el intento", () => {
  it("reservarIntento escribe la cuenta usada y la prevista; el intento abierto y la conciliación la devuelven", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    const id = await reservar(p.id, "igz", "mdp");
    await fijarReferenciaIntento(id, "ref-1");
    expect(await filas(p.id)).toEqual([expect.objectContaining({ cuenta: "igz", cuenta_prevista: "mdp" })]);
    expect(await intentoAbiertoDelPedido(p.id, dueno)).toMatchObject({ cuenta: "igz" });
    const pendientes = await intentosPendientesDeReconciliar({
      proveedor: "mercadopago",
      quietosDesde: new Date(Date.now() + 60_000),
      creadosDesde: new Date(Date.now() - 60_000),
      limite: 10,
    });
    expect(pendientes).toEqual([expect.objectContaining({ orderId: p.id, referencia: "ref-1", cuenta: "igz" })]);
    expect(await cuentaDelIntentoPorReferencia("mercadopago", "ref-1")).toBe("igz");
  });

  it("intento anterior a la 0035 (cuenta NULL): sigue funcionando y devuelve cuenta null (se deriva del pedido)", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    await getDb().execute(
      sql`insert into shop.pago_intentos (tenant_id, order_id, proveedor, referencia, estado) values (${TENANT}, ${p.id}, 'mercadopago', 'ref-viejo', 'pendiente')`,
    );
    expect(await intentoAbiertoDelPedido(p.id, dueno)).toMatchObject({ cuenta: null, referencia: "ref-viejo" });
    await registrarCobro(p.id, { proveedor: "mercadopago", referencia: "ref-viejo", estado: "pagado", detalle: "accredited", info: { marca: "Visa" } }, { avisar: false });
    const o = await pedidoDb(p.id);
    expect(o.pago_estado).toBe("pagado");
    // Sin cuenta en la fila: pago_info sin claves de cuenta (el CRM no muestra nada).
    expect(o.pago_info).toEqual({ marca: "Visa" });
  });
});

describe("orders.pago_info.cuentaCobro", () => {
  it("cobro aprobado con la prevista: cuentaCobro sin cuentaCobroPrevista", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    const id = await reservar(p.id, "mdp", "mdp");
    await registrarCobro(p.id, { proveedor: "mercadopago", referencia: "ref-a", estado: "pagado", detalle: "accredited", info: { marca: "Visa", ultimos4: "4242" } }, { intentoId: id, avisar: false });
    expect((await pedidoDb(p.id)).pago_info).toEqual({ marca: "Visa", ultimos4: "4242", cuentaCobro: "mdp" });
  });

  it("cobro aprobado con fallback: cuentaCobro y cuentaCobroPrevista", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    const id = await reservar(p.id, "igz", "mdp");
    await registrarCobro(p.id, { proveedor: "mercadopago", referencia: "ref-b", estado: "pagado", detalle: "accredited" }, { intentoId: id, avisar: false });
    expect((await pedidoDb(p.id)).pago_info).toEqual({ cuentaCobro: "igz", cuentaCobroPrevista: "mdp" });
  });

  it("el webhook que recupera un pago sin reserva crea la fila con la cuenta que firmó", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    await registrarCobro(p.id, {
      proveedor: "mercadopago",
      referencia: "ref-huerfano",
      estado: "pagado",
      detalle: "accredited",
      cuenta: "mdp",
      cuentaPrevista: "mdp",
    }, { avisar: false });
    expect(await filas(p.id)).toEqual([expect.objectContaining({ cuenta: "mdp", cuenta_prevista: "mdp", referencia: "ref-huerfano" })]);
    expect((await pedidoDb(p.id)).pago_info).toEqual({ cuentaCobro: "mdp" });
  });

  it("una fila existente conserva la cuenta con la que se reservó aunque el aviso traiga otra", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    const id = await reservar(p.id, "mdp", "mdp");
    await fijarReferenciaIntento(id, "ref-c");
    await registrarCobro(p.id, { proveedor: "mercadopago", referencia: "ref-c", estado: "pagado", detalle: "accredited", cuenta: "igz", cuentaPrevista: "mdp" }, { avisar: false });
    expect(await filas(p.id)).toEqual([expect.objectContaining({ cuenta: "mdp" })]);
  });
});

describe("evidencia de credenciales rechazadas (por pedido, en la base)", () => {
  it("intento cerrado por 401: la cuenta queda rechazada para ESTE pedido, sin tocar pago_estado", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    const id = await reservar(p.id, "mdp", "mdp");
    await cerrarIntentoSinPago(id, detalleCredencialesRechazadas("mdp"));
    expect(await cuentasRechazadasDelPedido(p.id, "mercadopago")).toEqual(["mdp"]);
    expect(await cuentasRechazadasDelPedido(p.id, "payway")).toEqual([]);
    expect((await pedidoDb(p.id)).pago_estado).toBe("pendiente");

    // El reintento del mismo pedido se reserva con la otra cuenta (el intento anterior está cerrado).
    const otro = await reservar(p.id, "igz", "mdp");
    expect(otro).toBeTruthy();
    expect((await filas(p.id)).map((f) => f.cuenta)).toEqual(["mdp", "igz"]);

    // Otro pedido no hereda la evidencia: vuelve a la prevista.
    const nuevo = await crearPedido(cliente, datos, cotizacion);
    expect(await cuentasRechazadasDelPedido(nuevo.id, "mercadopago")).toEqual([]);
  });

  it("registrarCuentaRechazada (informada por el navegador): fila cerrada, sin tocar pago_estado ni bloquear el próximo intento", async () => {
    const p = await crearPedido(cliente, datos, cotizacion);
    expect(await registrarCuentaRechazada(p.id, "payway", "mdp", "mdp", "cliente")).toBe(true);
    expect(await filas(p.id)).toEqual([
      expect.objectContaining({ cuenta: "mdp", cuenta_prevista: "mdp", estado: "fallido", detalle: "credenciales_rechazadas:mdp:cliente" }),
    ]);
    expect(await cuentasRechazadasDelPedido(p.id, "payway")).toEqual(["mdp"]);
    expect((await pedidoDb(p.id)).pago_estado).toBe("pendiente");
    expect(await intentoAbiertoDelPedido(p.id, dueno)).toBeNull();
    expect(await registrarCuentaRechazada("00000000-0000-4000-8000-000000000000", "payway", "mdp", null, "cliente")).toBe(false);
  });
});

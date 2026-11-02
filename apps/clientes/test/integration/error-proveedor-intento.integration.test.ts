import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  cerrarIntentoSinPago,
  crearPedido,
  descartarReserva,
  detalleCredencialesRechazadas,
  fijarReferenciaIntento,
  registrarCobro,
  registrarErrorIntento,
  registrarIntentoFallido,
  reservarIntento,
  type DatosCliente,
  type DatosPedido,
} from "@/lib/pedidos";
import { errorDeCatch } from "@/lib/pagos/detalle-proveedor";
import { ErrorProveedor } from "@/lib/pagos/tipos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Diagnóstico del error del proveedor en el intento (migración 0041), contra Postgres REAL (local).
 * Reproduce el orden del catch de `cobrarPedido` (registrarErrorIntento ANTES de cerrar o descartar) con
 * las mismas funciones. Datos inventados.
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
const cotizacion: Cotizacion = { lineas: [linea], subtotal: 1000, iva: 210, costoEnvio: 0, total: 1210, hayProblemas: false, listaPrivada: false, flujo: "normal" };

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

async function nuevoIntento(proveedor = "mercadopago") {
  const p = await crearPedido(cliente, datos, cotizacion);
  const r = await reservarIntento(p.id, proveedor, "tarjeta", undefined, { cuenta: "igz", cuentaPrevista: "igz" });
  if (!r || !("intentoId" in r)) throw new Error("sin intento");
  return { pedidoId: p.id, intentoId: r.intentoId };
}

async function intento(id: string) {
  const [f] = (await getDb().execute(
    sql`select estado, detalle, referencia, error_proveedor, error_status from shop.pago_intentos where id = ${id}`,
  )) as unknown as {
    estado: string;
    detalle: string | null;
    referencia: string | null;
    error_proveedor: string | null;
    error_status: number | null;
  }[];
  return f;
}

describe("registrarErrorIntento", () => {
  it("5xx de MP: el intento sigue 'pendiente' con error_status=500 y el error saneado", async () => {
    const { pedidoId, intentoId } = await nuevoIntento();
    const err = new ErrorProveedor("Mercado Pago respondió 500", 500, "message: internal_error; status: 500");
    await registrarErrorIntento(intentoId, errorDeCatch(err));
    await registrarIntentoFallido(pedidoId, err.message); // sin intentoId: la reserva queda abierta
    const f = await intento(intentoId);
    expect(f).toMatchObject({ estado: "pendiente", error_status: 500 });
    expect(f.error_proveedor).toContain("internal_error");
  });

  it("tras descartarReserva ('reserva_abandonada') el error sigue intacto", async () => {
    const { intentoId } = await nuevoIntento();
    await registrarErrorIntento(intentoId, { detalle: "message: internal_error", status: 500 });
    await descartarReserva(intentoId, "reserva_abandonada");
    expect(await intento(intentoId)).toMatchObject({
      estado: "fallido",
      detalle: "reserva_abandonada",
      error_status: 500,
      error_proveedor: "message: internal_error",
    });
  });

  it("4xx: cierra como fallido y conserva error_status=400", async () => {
    const { pedidoId, intentoId } = await nuevoIntento();
    const err = new ErrorProveedor("Mercado Pago respondió 400", 400, "message: bad_request");
    await registrarErrorIntento(intentoId, errorDeCatch(err));
    await registrarIntentoFallido(pedidoId, err.message, intentoId);
    expect(await intento(intentoId)).toMatchObject({ estado: "fallido", error_status: 400, error_proveedor: "message: bad_request" });
  });

  it("credenciales_rechazadas conserva el 401", async () => {
    const { intentoId } = await nuevoIntento();
    await registrarErrorIntento(intentoId, errorDeCatch(new ErrorProveedor("Mercado Pago respondió 401", 401, "message: invalid_token")));
    await cerrarIntentoSinPago(intentoId, detalleCredencialesRechazadas("igz"));
    const f = await intento(intentoId);
    expect(f.estado).toBe("fallido");
    expect(f.detalle).toMatch(/^credenciales_rechazadas:/);
    expect(f.error_status).toBe(401);
  });

  it("con referencia ya anotada (Payway) y 4xx: se cierra aparte y conserva el error", async () => {
    const { intentoId } = await nuevoIntento("payway");
    await fijarReferenciaIntento(intentoId, "ref-payway-1");
    await registrarErrorIntento(intentoId, { detalle: "error_type: invalid_request_error", status: 400 });
    await cerrarIntentoSinPago(intentoId, "error_proveedor: Payway respondió 400");
    expect(await intento(intentoId)).toMatchObject({ estado: "fallido", error_status: 400 });
  });

  it("timeout: texto fijo y status NULL", async () => {
    const { intentoId } = await nuevoIntento();
    await registrarErrorIntento(intentoId, errorDeCatch(Object.assign(new Error("x"), { name: "TimeoutError" })));
    expect(await intento(intentoId)).toMatchObject({ error_proveedor: "tiempo de espera agotado", error_status: null });
  });

  it("cada intento guarda su propio error: el reintento exitoso no pisa el del previo", async () => {
    const primero = await nuevoIntento();
    await registrarErrorIntento(primero.intentoId, { detalle: "message: internal_error", status: 500 });
    await descartarReserva(primero.intentoId, "reserva_abandonada");
    const segundo = await reservarIntento(primero.pedidoId, "mercadopago", "tarjeta", undefined, { cuenta: "igz", cuentaPrevista: "igz" });
    if (!segundo || !("intentoId" in segundo)) throw new Error("sin segundo intento");
    await registrarCobro(
      primero.pedidoId,
      { proveedor: "mercadopago", referencia: "pay-ok", estado: "pagado", detalle: "accredited" },
      { intentoId: segundo.intentoId, avisar: false },
    );
    expect(await intento(primero.intentoId)).toMatchObject({ error_status: 500, error_proveedor: "message: internal_error" });
    expect(await intento(segundo.intentoId)).toMatchObject({ estado: "pagado", error_status: null, error_proveedor: null });
  });

  it("rechazo del banco con status_detail deja el error en NULL", async () => {
    const { pedidoId, intentoId } = await nuevoIntento();
    await registrarCobro(
      pedidoId,
      { proveedor: "mercadopago", referencia: "pay-rech", estado: "fallido", detalle: "cc_rejected_insufficient_amount" },
      { intentoId, avisar: false },
    );
    expect(await intento(intentoId)).toMatchObject({ estado: "fallido", error_proveedor: null, error_status: null });
  });

  it("el texto se vuelve a sanear y el CHECK rechaza lo que pase de 500", async () => {
    const { intentoId } = await nuevoIntento();
    await registrarErrorIntento(intentoId, { detalle: `contacto a@cliente.example ${"x ".repeat(400)}`, status: 502 });
    const f = await intento(intentoId);
    expect(f.error_proveedor).not.toContain("cliente.example");
    expect(f.error_proveedor!.length).toBeLessThanOrEqual(500);
    await expect(
      getDb().execute(sql`update shop.pago_intentos set error_proveedor = ${"y".repeat(501)} where id = ${intentoId}`),
    ).rejects.toThrow();
  });
});

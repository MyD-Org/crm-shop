import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crearPedido, registrarCobro, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { cotizarMetodo } from "@/lib/envio-zona";
import { metodoDePrueba } from "@/test/envio-metodo";
import { assertLocalTestDb } from "./db-url";

/**
 * Fecha real de entrega del envío por zona (change `envio-por-zona-con-tarifa`): el pago aprobado es el
 * primer evento de confirmación y fija `envio_confirmado_en` / `envio_entrega_confirmada` con el horario
 * CONGELADO del pedido (corte 09:00 hora argentina, lunes a viernes). Idempotente; un pedido sin envío
 * por zona no se toca. Contra Postgres REAL (local, datos inventados).
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente@cliente.example" };

const linea: LineaCotizada = {
  id: "item-1", code: "COD-1", name: "Producto 1", brand: "Marca", qty: 1,
  precioUnitario: 1000, ivaPorcentaje: 21, subtotal: 1000, iva: 210, total: 1210, stockDisponible: null,
};
const cotizacion = (envio: number): Cotizacion => ({
  lineas: [linea], subtotal: 1000, iva: 210, costoEnvio: envio, total: 1210 + envio, hayProblemas: false, listaPrivada: false, flujo: "normal",
});

const resultado = cotizarMetodo(
  metodoDePrueba(),
  { provinciaClave: "buenosaires", cp: "7600" },
  { origen: null, subtotalSinIva: 1000, gratisTienda: false, gratisCupon: false },
)!;
const conEnvio: DatosPedido = {
  contactoNombre: "Cliente",
  contactoTelefono: "1100000000",
  entregaTipo: "envio",
  entregaCiudad: "Ciudad Ejemplo",
  entregaDireccion: "Calle Ejemplo 123",
  pagoMetodo: "mercadopago",
  envioZona: { resultado, punto: null, sucursalOrigen: null },
};

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts restart identity cascade`);
  });
}

async function sembrar() {
  await getDb().execute(sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`);
  await getDb().execute(sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status) values (${TENANT}, 'item-1', 'Producto 1', 10, 'active')`);
}

const cobro = (extra: Record<string, unknown> = {}) => ({
  proveedor: "mercadopago",
  referencia: "ref-1",
  estado: "pagado" as const,
  detalle: "accredited",
  medio: "tarjeta",
  cuotas: 1,
  totalPagado: 4210,
  ...extra,
});

type Fila = { envio_confirmado_en: string | null; envio_entrega_confirmada: string | null; pago_estado: string; envio_entrega_estimada: string | null };
async function fila(id: string): Promise<Fila> {
  return ((await getDb().execute(
    sql`select envio_confirmado_en, envio_entrega_confirmada, pago_estado, envio_entrega_estimada from shop.orders where id = ${id}`,
  )) as unknown as Fila[])[0];
}

/** Fija la hora del servidor sin tocar los timers (la conexión a la base los necesita). */
const ahora = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

beforeEach(async () => {
  await limpiar();
  await sembrar();
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  vi.useRealTimers();
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("registrarCobro: confirmación del envío por zona", () => {
  it("pago aprobado antes del corte (martes 08:00 AR): se entrega el mismo día", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-10T11:00:00Z"); // martes 08:00 en Buenos Aires
    await registrarCobro(p.id, cobro(), { avisar: false });
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
    expect((f.envio_confirmado_en ? new Date(f.envio_confirmado_en).toISOString() : null)).toBe("2026-11-10T11:00:00.000Z");
    expect(f.envio_entrega_confirmada).toBe("2026-11-10");
  });

  it("confirmación tarde (martes 12:00 AR): al día siguiente", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-10T15:00:00Z");
    await registrarCobro(p.id, cobro(), { avisar: false });
    expect((await fila(p.id)).envio_entrega_confirmada).toBe("2026-11-11");
  });

  it("viernes 15:00 AR: el lunes", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-13T18:00:00Z");
    await registrarCobro(p.id, cobro(), { avisar: false });
    expect((await fila(p.id)).envio_entrega_confirmada).toBe("2026-11-16");
  });

  it("borde de zona horaria: 23:30 AR de un martes ya es miércoles en UTC y se entrega el miércoles", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-11T02:30:00Z"); // martes 23:30 AR = miércoles 02:30 UTC
    await registrarCobro(p.id, cobro(), { avisar: false });
    expect((await fila(p.id)).envio_entrega_confirmada).toBe("2026-11-11");
  });

  it("idempotente: el mismo pago por segunda vez (webhook repetido) no recalcula la fecha", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-10T11:00:00Z");
    await registrarCobro(p.id, cobro(), { avisar: false });
    ahora("2026-11-12T11:00:00Z");
    await registrarCobro(p.id, cobro(), { avisar: false });
    const f = await fila(p.id);
    expect((f.envio_confirmado_en ? new Date(f.envio_confirmado_en).toISOString() : null)).toBe("2026-11-10T11:00:00.000Z");
    expect(f.envio_entrega_confirmada).toBe("2026-11-10");
  });

  it("un rechazo o un pago pendiente no confirman nada", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-10T11:00:00Z");
    await registrarCobro(p.id, cobro({ estado: "fallido", detalle: "cc_rejected" }), { avisar: false });
    expect((await fila(p.id)).envio_confirmado_en).toBeNull();
  });

  it("un pago revertido con el pedido todavía pendiente limpia la confirmación", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-10T11:00:00Z");
    await registrarCobro(p.id, cobro(), { avisar: false });
    expect((await fila(p.id)).envio_confirmado_en).not.toBeNull();
    await registrarCobro(p.id, cobro({ estado: "fallido", detalle: "charged_back", reversion: true }), { avisar: false });
    const f = await fila(p.id);
    expect(f.pago_estado).not.toBe("pagado");
    expect(f.envio_confirmado_en).toBeNull();
    expect(f.envio_entrega_confirmada).toBeNull();
  });

  it("si un operador ya avanzó el pedido, revertir el pago NO borra esa confirmación", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    ahora("2026-11-10T11:00:00Z");
    await registrarCobro(p.id, cobro(), { avisar: false });
    await getDb().execute(sql`update shop.orders set estado = 'confirmado' where id = ${p.id}`);
    await registrarCobro(p.id, cobro({ estado: "fallido", detalle: "charged_back", reversion: true }), { avisar: false });
    expect((await fila(p.id)).envio_entrega_confirmada).toBe("2026-11-10");
  });

  it("pedido sin envío por zona (retiro): el pago no toca las columnas del envío", async () => {
    const p = await crearPedido(
      cliente,
      { ...conEnvio, entregaTipo: "retiro", entregaCiudad: undefined, entregaDireccion: undefined, envioZona: undefined },
      cotizacion(0),
    );
    ahora("2026-11-10T11:00:00Z");
    await registrarCobro(p.id, cobro({ totalPagado: 1210 }), { avisar: false });
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
    expect(f.envio_confirmado_en).toBeNull();
    expect(f.envio_entrega_confirmada).toBeNull();
  });

  it("la estimación al crear NO es la confirmada: la confirmada queda vacía hasta el pago", async () => {
    const p = await crearPedido(cliente, conEnvio, cotizacion(3000));
    const f = await fila(p.id);
    expect(f.envio_entrega_estimada).not.toBeNull();
    expect(f.envio_entrega_confirmada).toBeNull();
  });
});

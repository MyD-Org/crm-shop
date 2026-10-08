import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crearPedido, registrarCobro, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Cuotas sin interés congeladas en el pedido y reconciliación del cobro, contra Postgres REAL
 * (local). El pedido guarda las cuotas elegidas (1 = un pago, null = sin cuotas); al registrar el
 * cobro, lo que informa el procesador se compara con lo congelado y una discrepancia deja el pedido
 * marcado para revisión (sin bloquear ni revertir el cobro). Datos inventados.
 */

const TENANT = process.env.SHOP_TENANT_ID!;

const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente@cliente.example" };

const datos = (extra: Partial<DatosPedido> = {}): DatosPedido => ({
  contactoNombre: "Cliente de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "mercadopago",
  ...extra,
});

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

async function fila(id: string) {
  const [f] = (await getDb().execute(
    sql`select cuotas, cuotas_max, cuotas_plan, pago_estado, pago_revision, total from shop.orders where id = ${id}`,
  )) as unknown as {
    cuotas: number | null;
    cuotas_max: number | null;
    cuotas_plan: unknown;
    pago_estado: string;
    pago_revision: string | null;
    total: string;
  }[];
  return f;
}

const cobro = (extra: { cuotas?: number; totalPagado?: number } = {}) => ({
  proveedor: "mercadopago",
  referencia: "ref-1",
  estado: "pagado" as const,
  detalle: "accredited",
  medio: "tarjeta",
  ...extra,
});

beforeEach(async () => {
  await limpiar();
  await sembrar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("crearPedido congela las cuotas", () => {
  it.each([1, 3, 6])("cuotas=%i queda en el pedido (y no se escribe el plan viejo)", async (n) => {
    const p = await crearPedido(cliente, datos({ cuotas: n }), cotizacion);
    expect(p.cuotas).toBe(n);
    const f = await fila(p.id);
    expect(f.cuotas).toBe(n);
    expect(f.cuotas_max).toBeNull();
    expect(f.cuotas_plan).toBeNull();
  });

  it("sin cuotas (flag apagado o medio sin cobro en línea): null", async () => {
    const p = await crearPedido(cliente, datos(), cotizacion);
    expect(p.cuotas).toBeNull();
    expect((await fila(p.id)).cuotas).toBeNull();
  });

  it("el reintento idempotente devuelve las cuotas del pedido original", async () => {
    const clave = "11111111-2222-4333-8444-555555555555";
    const a = await crearPedido(cliente, datos({ cuotas: 6, idempotencyKey: clave }), cotizacion);
    const b = await crearPedido(cliente, datos({ cuotas: 3, idempotencyKey: clave }), cotizacion);
    expect(b.repetido).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.cuotas).toBe(6);
  });
});

describe("registrarCobro: reconciliación de cuotas y monto", () => {
  async function pedidoEn(cuotas: number | null) {
    return crearPedido(cliente, datos({ cuotas }), cotizacion);
  }

  it("coincide (cuotas y total): sin marca de revisión", async () => {
    const p = await pedidoEn(6);
    await registrarCobro(p.id, cobro({ cuotas: 6, totalPagado: 1210 }), { avisar: false });
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
    expect(f.pago_revision).toBeNull();
  });

  it("cuotas distintas: queda pagado pero marcado cuotas_distintas", async () => {
    const p = await pedidoEn(6);
    await registrarCobro(p.id, cobro({ cuotas: 12, totalPagado: 1210 }), { avisar: false });
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
    expect(f.pago_revision).toBe("cuotas_distintas");
  });

  it("monto distinto (el procesador cobró interés): marcado monto_distinto", async () => {
    const p = await pedidoEn(6);
    await registrarCobro(p.id, cobro({ cuotas: 6, totalPagado: 1300 }), { avisar: false });
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
    expect(f.pago_revision).toBe("monto_distinto");
  });

  it("pedido sin cuotas congeladas: nunca se marca por esto", async () => {
    const p = await pedidoEn(null);
    await registrarCobro(p.id, cobro({ cuotas: 12, totalPagado: 5000 }), { avisar: false });
    expect((await fila(p.id)).pago_revision).toBeNull();
  });

  it("un pago que no se acreditó no se reconcilia", async () => {
    const p = await pedidoEn(6);
    await registrarCobro(p.id, { ...cobro({ cuotas: 3, totalPagado: 1 }), estado: "fallido" as const }, { avisar: false });
    expect((await fila(p.id)).pago_revision).toBeNull();
  });
});

describe("registrarCobro: medio con el que se cobró (pago_info)", () => {
  it("se guarda en el intento y en el pedido; un evento sin info no lo borra", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 6 }), cotizacion);
    const info = { tipo: "credito" as const, marca: "Mastercard", ultimos4: "4623", aprobadoEn: "2026-10-07T19:30:00.000Z" };
    await registrarCobro(p.id, { ...cobro({ cuotas: 6, totalPagado: 1210 }), info }, { avisar: false });
    await registrarCobro(p.id, cobro({ cuotas: 6, totalPagado: 1210 }), { avisar: false });
    const [f] = (await getDb().execute(
      sql`select o.pago_info, i.info from shop.orders o join shop.pago_intentos i on i.order_id = o.id where o.id = ${p.id}`,
    )) as unknown as { pago_info: unknown; info: unknown }[];
    expect(f.pago_info).toEqual(info);
    expect(f.info).toEqual(info);
  });
});

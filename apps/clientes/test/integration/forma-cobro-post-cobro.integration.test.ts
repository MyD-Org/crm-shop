import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crearPedido, registrarCobro, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import type { TipoMedioPago } from "@/lib/pagos/tipos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Red post-cobro de la forma de pago (listas de precio por forma, rebanada D), contra Postgres REAL
 * (local). Con `forma_cobro` congelada, un pago aprobado cuyo tipo REAL (info.tipo, lo que devolvió el
 * procesador) no es esa forma deja el intento `pagado` pero el pedido `pendiente` y marcado
 * `forma_distinta`. Idempotente. Datos inventados.
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
    sql`select forma_cobro, pago_estado, pago_revision, total from shop.orders where id = ${id}`,
  )) as unknown as { forma_cobro: string | null; pago_estado: string; pago_revision: string | null; total: string }[];
  return f;
}

async function intentos(id: string) {
  return (await getDb().execute(
    sql`select estado from shop.pago_intentos where order_id = ${id} order by created_at`,
  )) as unknown as { estado: string }[];
}

const cobro = (tipo: TipoMedioPago | undefined, extra: { totalPagado?: number; proveedor?: string; referencia?: string } = {}) => ({
  proveedor: extra.proveedor ?? "mercadopago",
  referencia: extra.referencia ?? "ref-1",
  estado: "pagado" as const,
  detalle: "accredited",
  medio: "tarjeta",
  cuotas: 1,
  totalPagado: extra.totalPagado ?? 1210,
  ...(tipo ? { info: { tipo, marca: "Visa" } } : {}),
});

const pagar = (id: string, c: ReturnType<typeof cobro>) => registrarCobro(id, c, { avisar: false });

beforeEach(async () => {
  await limpiar();
  await sembrar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("registrarCobro: forma_distinta (red post-cobro)", () => {
  it("MP: credit_card con forma_cobro=debito: intento pagado, pedido pendiente, forma_distinta", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 1, formaCobro: "debito" }), cotizacion);
    await pagar(p.id, cobro("credito"));
    const f = await fila(p.id);
    expect(f.forma_cobro).toBe("debito");
    expect(f.pago_estado).toBe("pendiente");
    expect(f.pago_revision).toBe("forma_distinta");
    expect((await intentos(p.id)).map((i) => i.estado)).toEqual(["pagado"]);
  });

  it("es idempotente: el mismo pago por segunda vez (webhook) no cambia nada ni duplica intentos", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 1, formaCobro: "debito" }), cotizacion);
    await pagar(p.id, cobro("credito"));
    await pagar(p.id, cobro("credito"));
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pendiente");
    expect(f.pago_revision).toBe("forma_distinta");
    expect(await intentos(p.id)).toHaveLength(1);
  });

  it("convive con monto_distinto: gana monto, una sola marca", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 1, formaCobro: "debito" }), cotizacion);
    await pagar(p.id, cobro("credito", { totalPagado: 500 }));
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pendiente");
    expect(f.pago_revision).toBe("monto_distinto");
  });

  it("forma_cobro NULL: pagado normal aunque el tipo sea cualquiera", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 1 }), cotizacion);
    await pagar(p.id, cobro("credito"));
    const f = await fila(p.id);
    expect(f.forma_cobro).toBeNull();
    expect(f.pago_estado).toBe("pagado");
    expect(f.pago_revision).toBeNull();
  });

  it.each([
    ["credito", "credito"],
    ["debito", "debito"],
    ["debito", "prepaga"],
    ["cuenta_mp", "dinero_en_cuenta"],
  ] as const)("forma %s con tipo real %s: coincide, pagado sin marca", async (forma, tipo) => {
    const p = await crearPedido(cliente, datos({ cuotas: 1, formaCobro: forma }), cotizacion);
    await pagar(p.id, cobro(tipo));
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
    expect(f.pago_revision).toBeNull();
  });

  it("tipo ausente (ticket, transferencia, id desconocido): no acusa", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 1, formaCobro: "debito" }), cotizacion);
    await pagar(p.id, cobro(undefined));
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
    expect(f.pago_revision).toBeNull();
  });

  it("cuenta_mp congelada y cobro con tarjeta de crédito: forma_distinta", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 1, formaCobro: "cuenta_mp" }), cotizacion);
    await pagar(p.id, cobro("credito"));
    expect((await fila(p.id)).pago_revision).toBe("forma_distinta");
  });

  it("Payway: respuesta de débito con forma crédito acusa; crédito con crédito confirma", async () => {
    const malo = await crearPedido(cliente, datos({ pagoMetodo: "payway", cuotas: 1, formaCobro: "credito" }), cotizacion);
    await pagar(malo.id, cobro("debito", { proveedor: "payway", referencia: "pw-malo" }));
    expect(await fila(malo.id)).toMatchObject({ pago_estado: "pendiente", pago_revision: "forma_distinta" });

    const bueno = await crearPedido(cliente, datos({ pagoMetodo: "payway", cuotas: 1, formaCobro: "credito" }), cotizacion);
    await pagar(bueno.id, cobro("credito", { proveedor: "payway", referencia: "pw-bueno" }));
    expect(await fila(bueno.id)).toMatchObject({ pago_estado: "pagado", pago_revision: null });
  });

  it("un segundo cobro que coincide con la forma acredita el pedido y limpia la marca", async () => {
    const p = await crearPedido(cliente, datos({ cuotas: 1, formaCobro: "debito" }), cotizacion);
    await pagar(p.id, cobro("credito", { referencia: "ref-1" }));
    expect((await fila(p.id)).pago_revision).toBe("forma_distinta");
    // El primer pago (forma mal) sigue sin acreditar; otro intento con la forma correcta lo hace.
    await pagar(p.id, cobro("debito", { referencia: "ref-2" }));
    const f = await fila(p.id);
    expect(f.pago_estado).toBe("pagado");
  });
});

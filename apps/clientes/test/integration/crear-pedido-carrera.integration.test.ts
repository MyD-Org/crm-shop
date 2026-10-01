import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crearPedido, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import { StockInsuficienteError } from "@/lib/stock-disponible";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Carrera de compras simultáneas contra Postgres REAL (local): `crearPedido` serializa por ítem con
 * `pg_advisory_xact_lock` y relee el disponible (stock del CRM − reserva) antes de escribir las
 * líneas. Con stock 1 y N checkouts a la vez, exactamente uno tiene que confirmarse y el resto
 * fallar con `StockInsuficienteError`; la reserva (vista `shop.stock_reservado`) tiene que quedar
 * en lo que se vendió, nunca por encima del stock. También la idempotencia: la misma clave en
 * paralelo crea un solo pedido. Datos inventados.
 */

const TENANT = process.env.SHOP_TENANT_ID!; // lo fija vitest.config.mts (proyecto integration)

const cliente = (n: number): DatosCliente => ({ clerkUserId: `user_${n}`, email: `cliente${n}@cliente.example` });

const datos = (extra: Partial<DatosPedido> = {}): DatosPedido => ({
  contactoNombre: "Cliente de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "transferencia",
  ...extra,
});

function linea(id: string, qty: number): LineaCotizada {
  return {
    id,
    code: `COD-${id}`,
    name: `Producto ${id}`,
    brand: "Marca",
    qty,
    precioUnitario: 100,
    ivaPorcentaje: 21,
    subtotal: 100 * qty,
    iva: 21 * qty,
    total: 121 * qty,
    stockDisponible: null,
  };
}

function cotizacion(...lineas: LineaCotizada[]): Cotizacion {
  const subtotal = lineas.reduce((a, l) => a + l.subtotal, 0);
  const iva = lineas.reduce((a, l) => a + l.iva, 0);
  return { lineas, subtotal, iva, costoEnvio: 0, total: subtotal + iva, hayProblemas: false, listaPreferencial: false };
}

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  // El cascade emite un NOTICE por cada tabla alcanzada: se silencia sólo en esta transacción.
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(
      sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts restart identity cascade`,
    );
  });
}

/** Tenant + productos del espejo del CRM (`public.catalog_products`, que lee la vista del Shop). */
async function sembrar(stockPorItem: Record<string, number | null>) {
  const db = getDb();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  for (const [id, stock] of Object.entries(stockPorItem)) {
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status) values (${TENANT}, ${id}, ${"Producto " + id}, ${stock}, 'active')`,
    );
  }
}

type Resultado = PromiseSettledResult<Awaited<ReturnType<typeof crearPedido>>>;

const ok = (r: Resultado[]) => r.filter((x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof crearPedido>>> => x.status === "fulfilled");
const falladas = (r: Resultado[]) => r.filter((x): x is PromiseRejectedResult => x.status === "rejected");

async function reservado(): Promise<Record<string, number>> {
  const filas = (await getDb().execute(
    sql`select alegra_item_id, qty from shop.stock_reservado where tenant_id = ${TENANT}`,
  )) as unknown as { alegra_item_id: string; qty: string }[];
  return Object.fromEntries(filas.map((f) => [f.alegra_item_id, Number(f.qty)]));
}

async function contar(tabla: "orders" | "order_items"): Promise<number> {
  const [f] = (await getDb().execute(sql.raw(`select count(*)::int as n from shop.${tabla}`))) as unknown as { n: number }[];
  return f.n;
}

afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("crearPedido: carrera por el último stock", () => {
  beforeEach(async () => {
    await limpiar();
  });
  it.each([2, 5, 10])("stock 1 y %i compras simultáneas: se confirma una y el resto falla por stock", async (n) => {
    await sembrar({ "item-1": 1 });

    const r = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => crearPedido(cliente(i), datos(), cotizacion(linea("item-1", 1)))),
    );

    expect(ok(r)).toHaveLength(1);
    expect(ok(r)[0].value.repetido).toBe(false);
    const errores = falladas(r);
    expect(errores).toHaveLength(n - 1);
    for (const e of errores) {
      expect(e.reason).toBeInstanceOf(StockInsuficienteError);
      expect((e.reason as StockInsuficienteError).ids).toEqual(["item-1"]);
    }

    // Consistencia: un solo pedido con su línea; los rechazados se deshicieron enteros.
    expect(await contar("orders")).toBe(1);
    expect(await contar("order_items")).toBe(1);
    expect(await reservado()).toEqual({ "item-1": 1 });
  });

  it("stock 5, 8 compras de 2 unidades: se confirman exactamente 2 y la reserva nunca pasa del stock", async () => {
    await sembrar({ "item-1": 5 });

    const r = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => crearPedido(cliente(i), datos(), cotizacion(linea("item-1", 2)))),
    );

    expect(ok(r)).toHaveLength(2);
    expect(falladas(r)).toHaveLength(6);
    for (const e of falladas(r)) expect(e.reason).toBeInstanceOf(StockInsuficienteError);
    expect(await contar("orders")).toBe(2);
    expect(await reservado()).toEqual({ "item-1": 4 });
  });

  it("carritos de varios ítems en distinto orden: no se traban (sin deadlock) y se confirma uno solo", async () => {
    await sembrar({ "item-a": 1, "item-b": 1 });

    const r = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        crearPedido(
          cliente(i),
          datos(),
          i % 2 === 0
            ? cotizacion(linea("item-a", 1), linea("item-b", 1))
            : cotizacion(linea("item-b", 1), linea("item-a", 1)),
        ),
      ),
    );

    expect(ok(r)).toHaveLength(1);
    for (const e of falladas(r)) expect(e.reason).toBeInstanceOf(StockInsuficienteError);
    expect(await contar("orders")).toBe(1);
    expect(await contar("order_items")).toBe(2);
    expect(await reservado()).toEqual({ "item-a": 1, "item-b": 1 });
  });

  it("un pedido que no alcanza en UN ítem no reserva nada del otro (rollback completo)", async () => {
    await sembrar({ "item-a": 1, "item-b": 0 });

    await expect(
      crearPedido(cliente(1), datos(), cotizacion(linea("item-a", 1), linea("item-b", 1))),
    ).rejects.toMatchObject({ ids: ["item-b"] });

    expect(await contar("orders")).toBe(0);
    expect(await reservado()).toEqual({});
  });

  it("ítem no inventariable (stock null): nunca se agota", async () => {
    await sembrar({ servicio: null });

    const r = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => crearPedido(cliente(i), datos(), cotizacion(linea("servicio", 3)))),
    );

    expect(ok(r)).toHaveLength(5);
    expect(await contar("orders")).toBe(5);
  });

  it("la reserva de un pedido cancelado se libera y el stock vuelve a poder comprarse", async () => {
    await sembrar({ "item-1": 1 });
    const primero = await crearPedido(cliente(1), datos(), cotizacion(linea("item-1", 1)));
    await expect(crearPedido(cliente(2), datos(), cotizacion(linea("item-1", 1)))).rejects.toBeInstanceOf(
      StockInsuficienteError,
    );

    await getDb().execute(
      sql`update shop.orders set estado = 'cancelado', cancelacion_motivo = 'Prueba' where id = ${primero.id}`,
    );
    expect(await reservado()).toEqual({});

    const segundo = await crearPedido(cliente(2), datos(), cotizacion(linea("item-1", 1)));
    expect(segundo.repetido).toBe(false);
  });
});

describe("crearPedido: idempotencia en paralelo", () => {
  beforeEach(async () => {
    await limpiar();
  });

  it.each([2, 6])("la misma clave %i veces a la vez crea un solo pedido (aun con stock 1)", async (n) => {
    await sembrar({ "item-1": 1 });

    const r = await Promise.allSettled(
      Array.from({ length: n }, () =>
        crearPedido(
          cliente(1),
          datos({ idempotencyKey: "intento-0001" }),
          cotizacion(linea("item-1", 1)),
        ),
      ),
    );

    // Ninguno falla: los reintentos devuelven el pedido original en vez de chocar con el stock
    // que el propio pedido ya reserva.
    expect(falladas(r)).toHaveLength(0);
    const filas = ok(r).map((x) => x.value);
    expect(filas.filter((p) => !p.repetido)).toHaveLength(1);
    expect(filas.filter((p) => p.repetido)).toHaveLength(n - 1);
    expect(new Set(filas.map((p) => p.id)).size).toBe(1);
    expect(new Set(filas.map((p) => p.numero)).size).toBe(1);

    expect(await contar("orders")).toBe(1);
    expect(await contar("order_items")).toBe(1); // las líneas no se duplican
    expect(await reservado()).toEqual({ "item-1": 1 });
  });

  it("claves distintas no se pisan: cada intento es su propio pedido", async () => {
    await sembrar({ "item-1": 10 });

    const r = await Promise.allSettled(
      ["k-1", "k-2", "k-3"].map((k, i) =>
        crearPedido(cliente(i), datos({ idempotencyKey: k }), cotizacion(linea("item-1", 1))),
      ),
    );

    expect(ok(r)).toHaveLength(3);
    expect(await contar("orders")).toBe(3);
    expect(await reservado()).toEqual({ "item-1": 3 });
  });
});

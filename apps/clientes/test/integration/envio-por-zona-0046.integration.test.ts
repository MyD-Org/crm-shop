import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assertLocalTestDb } from "./db-url";

/**
 * Migración 0046 (change `envio-por-zona-con-tarifa`) contra Postgres REAL (local, datos inventados):
 * las columnas del snapshot existen y son nullable, y los CHECK de lat/lon y de la fecha confirmada
 * rechazan lo que corresponde.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
type Fila = Record<string, unknown>;
const q = async (c: ReturnType<typeof sql>) => (await getDb().execute(c)) as unknown as Fila[];

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.direcciones_envio, shop.order_items, shop.orders restart identity cascade`);
  });
}

const direccion = (lat: number | null, lon: number | null) =>
  getDb().execute(sql`
    insert into shop.direcciones_envio (tenant_id, clerk_user_id, calle, ciudad, lat, lon)
    values (${TENANT}, 'user_x', 'Calle 1 100', 'Mar del Plata', ${lat}, ${lon})`);

const pedido = (extra: ReturnType<typeof sql>) =>
  getDb().execute(sql`
    insert into shop.orders (tenant_id, cliente_email, contacto_nombre, contacto_telefono, entrega_tipo,
                             pago_metodo, subtotal, iva, total, estado, pago_estado, envio_metodo, envio_zona,
                             envio_confirmado_en)
    values (${TENANT}, 'comprador@cliente.example', 'Comprador', '1100000000', 'envio', 'transferencia',
            100, 21, 121, 'pendiente', 'pendiente', 'envio-en-el-dia', 'Centro', ${extra})`);

describe("0046 envío por zona", () => {
  beforeEach(limpiar);
  afterAll(limpiar);

  it("las columnas nuevas existen y son todas nullable, sin default", async () => {
    const filas = await q(sql`
      select table_name, column_name, is_nullable, column_default from information_schema.columns
      where table_schema = 'shop' and (
        (table_name = 'orders' and column_name like 'envio\_%' escape '\')
        or (table_name = 'direcciones_envio' and column_name in ('lat','lon')))`);
    const nombres = filas.map((f) => `${f.table_name}.${f.column_name}`).sort();
    expect(nombres).toEqual(
      [
        "direcciones_envio.lat",
        "direcciones_envio.lon",
        "orders.envio_confirmado_en",
        "orders.envio_detalle",
        "orders.envio_entrega_confirmada",
        "orders.envio_entrega_estimada",
        "orders.envio_gratis",
        "orders.envio_metodo",
        "orders.envio_promesa",
        "orders.envio_zona",
      ].sort(),
    );
    for (const f of filas.filter((x) => x.column_name !== "envio_gratis")) {
      expect(f.is_nullable).toBe("YES");
      expect(f.column_default).toBeNull();
    }
  });

  it("direcciones_envio: lat/lon ambas o ninguna, dentro de la caja argentina", async () => {
    await expect(direccion(null, null)).resolves.toBeDefined();
    await expect(direccion(-38.0055, -57.5426)).resolves.toBeDefined();
    await expect(direccion(-38.0055, null)).rejects.toThrow();
    await expect(direccion(null, -57.5426)).rejects.toThrow();
    await expect(direccion(40.4, -3.7)).rejects.toThrow(); // fuera de Argentina
    await expect(direccion(-38.0055, -3.7)).rejects.toThrow();
  });

  it("orders: entrega confirmada exige instante de confirmación", async () => {
    await expect(pedido(sql`${null}`)).resolves.toBeDefined();
    await expect(
      getDb().execute(sql`
        insert into shop.orders (tenant_id, cliente_email, contacto_nombre, contacto_telefono, entrega_tipo,
                                 pago_metodo, subtotal, iva, total, estado, pago_estado, envio_entrega_confirmada)
        values (${TENANT}, 'comprador@cliente.example', 'Comprador', '1100000000', 'envio', 'transferencia',
                100, 21, 121, 'pendiente', 'pendiente', '2026-11-13')`),
    ).rejects.toThrow();
  });
});

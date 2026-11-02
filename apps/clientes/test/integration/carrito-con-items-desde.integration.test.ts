import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { mergearCarrito, reemplazarCarrito, vaciarCarritoTx } from "@/lib/carrito-db";
import { assertLocalTestDb } from "./db-url";

/**
 * `shop.carts.con_items_desde` (migración 0041) con la tabla REAL: vacío -> ítem fija now(); editar conserva
 * y avanza updated_at; vaciar/quitar el último -> NULL. Y el backfill de la migración. Datos inventados.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const USUARIO = "user_carrito_1";

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table shop.carts restart identity cascade`);
  });
}
beforeEach(limpiar);
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

async function fila() {
  const [f] = (await getDb().execute(
    sql`select version, con_items_desde::text as con_items_desde, updated_at::text as updated_at, jsonb_array_length(items)::int as n from shop.carts where tenant_id = ${TENANT} and clerk_user_id = ${USUARIO}`,
  )) as unknown as { version: number; con_items_desde: string | null; updated_at: string; n: number }[];
  return f;
}
const ms = (v: string) => new Date(v).getTime();
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("con_items_desde", () => {
  it("primer guardado con ítems fija la fecha; sin ítems queda NULL", async () => {
    await reemplazarCarrito(USUARIO, 0, []);
    expect((await fila()).con_items_desde).toBeNull();
    const v = (await fila()).version;
    await reemplazarCarrito(USUARIO, v, [{ id: "a", qty: 1 }]);
    expect((await fila()).con_items_desde).not.toBeNull();
  });

  it("vacío -> ítem fija now(); editar la cantidad conserva T y avanza updated_at", async () => {
    await reemplazarCarrito(USUARIO, 0, []);
    let f = await fila();
    await reemplazarCarrito(USUARIO, f.version, [{ id: "a", qty: 1 }]);
    f = await fila();
    const T = f.con_items_desde;
    const U = f.updated_at;
    expect(T).not.toBeNull();

    await pausa(15);
    await reemplazarCarrito(USUARIO, f.version, [{ id: "a", qty: 3 }]);
    f = await fila();
    expect(f.con_items_desde).toBe(T);
    expect(ms(f.updated_at)).toBeGreaterThan(ms(U));
  });

  it("quitar el último ítem -> NULL, y al volver a agregar se fija una fecha nueva", async () => {
    await reemplazarCarrito(USUARIO, 0, [{ id: "a", qty: 1 }]);
    let f = await fila();
    const T = f.con_items_desde!;
    await reemplazarCarrito(USUARIO, f.version, []);
    f = await fila();
    expect(f.con_items_desde).toBeNull();
    await pausa(15);
    await reemplazarCarrito(USUARIO, f.version, [{ id: "b", qty: 1 }]);
    f = await fila();
    expect(ms(f.con_items_desde!)).toBeGreaterThan(ms(T));
  });

  it("vaciarCarritoTx (crear un pedido) -> NULL", async () => {
    await reemplazarCarrito(USUARIO, 0, [{ id: "a", qty: 1 }]);
    await vaciarCarritoTx(getDb(), USUARIO);
    const f = await fila();
    expect(f.n).toBe(0);
    expect(f.con_items_desde).toBeNull();
  });

  it("merge: sobre carrito inexistente con ítems fija la fecha; con invitado vacío queda NULL", async () => {
    await mergearCarrito(USUARIO, [{ id: "a", qty: 2 }]);
    expect((await fila()).con_items_desde).not.toBeNull();
    await limpiar();
    await mergearCarrito(USUARIO, []);
    expect((await fila()).con_items_desde).toBeNull();
  });

  it("merge sobre carrito con ítems conserva la fecha", async () => {
    await reemplazarCarrito(USUARIO, 0, [{ id: "a", qty: 1 }]);
    const T = (await fila()).con_items_desde!;
    await pausa(15);
    await mergearCarrito(USUARIO, [{ id: "b", qty: 1 }]);
    expect((await fila()).con_items_desde).toBe(T);
  });
});

describe("backfill de la migración 0041", () => {
  it("rellena con updated_at los carritos con ítems y deja NULL los vacíos", async () => {
    const antes = "2026-01-02T03:04:05.000Z";
    await getDb().execute(sql`
      insert into shop.carts (tenant_id, clerk_user_id, items, version, updated_at) values
        (${TENANT}, 'u_con', '[{"id":"a","qty":1}]'::jsonb, 1, ${antes}),
        (${TENANT}, 'u_vacio', '[]'::jsonb, 1, ${antes})`);
    // La misma sentencia que la migración.
    await getDb().execute(sql`UPDATE "shop"."carts" SET "con_items_desde" = "updated_at" WHERE jsonb_array_length("items") > 0`);
    const r = (await getDb().execute(
      sql`select clerk_user_id, con_items_desde::text as con_items_desde, updated_at::text as updated_at from shop.carts order by clerk_user_id`,
    )) as unknown as { clerk_user_id: string; con_items_desde: string | null; updated_at: string }[];
    const con = r.find((x) => x.clerk_user_id === "u_con")!;
    expect(con.con_items_desde).toBe(con.updated_at);
    expect(ms(con.con_items_desde!)).toBe(ms(antes));
    expect(r.find((x) => x.clerk_user_id === "u_vacio")!.con_items_desde).toBeNull();
  });
});

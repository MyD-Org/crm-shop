import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { leerCarrito, mergearCarrito, reemplazarCarrito, vaciarCarritoTx } from "@/lib/carrito-db";
import { assertLocalTestDb } from "./db-url";

/**
 * El cupón en el carrito del servidor (spec 2026-11-01-cupones-design.md, "Dónde se ingresa") contra
 * Postgres REAL (local, datos inventados): se guarda con el carrito, el merge conserva el del invitado si
 * el servidor no tenía, y se borra con el carrito al crear el pedido.
 */

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().execute(sql`truncate table shop.carts restart identity cascade`);
}

beforeEach(limpiar);
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("cupón en shop.carts", () => {
  it("se guarda con el carrito y un PUT sin cupón no lo toca", async () => {
    const r = await reemplazarCarrito("user_ana", 0, [{ id: "1", qty: 1 }], "luz-7kq2m");
    expect(r.ok && r.carrito.cupon).toBe("luz-7kq2m");
    const r2 = await reemplazarCarrito("user_ana", 1, [{ id: "1", qty: 2 }]);
    expect(r2.ok && r2.carrito.cupon).toBe("luz-7kq2m");
    expect((await leerCarrito("user_ana")).cupon).toBe("luz-7kq2m");
    await reemplazarCarrito("user_ana", 2, [{ id: "1", qty: 2 }], null);
    expect((await leerCarrito("user_ana")).cupon).toBeNull();
  });

  it("merge conserva el cupón del invitado si el servidor no tenía; si tenía, gana el del servidor", async () => {
    const a = await mergearCarrito("user_ana", [{ id: "1", qty: 1 }], "LUZ-7KQ2M");
    expect(a.cupon).toBe("LUZ-7KQ2M");
    expect((await leerCarrito("user_ana")).cupon).toBe("LUZ-7KQ2M");
    const b = await mergearCarrito("user_ana", [{ id: "2", qty: 1 }], "OTRO-AAAAA");
    expect(b.cupon).toBe("LUZ-7KQ2M");
  });

  it("vaciar (al crear el pedido) borra el cupón", async () => {
    await reemplazarCarrito("user_ana", 0, [{ id: "1", qty: 1 }], "LUZ-7KQ2M");
    await vaciarCarritoTx(getDb(), "user_ana");
    expect(await leerCarrito("user_ana")).toMatchObject({ items: [], cupon: null });
  });
});

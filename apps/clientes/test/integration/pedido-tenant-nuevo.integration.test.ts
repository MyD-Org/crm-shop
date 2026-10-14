import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crearPedido, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Pedido en la tienda de OTRO tenant (change `shop-para-avantec`, 3b.14) contra Postgres REAL
 * (local): con `SHOP_TENANT_ID` de la tienda nueva, `orders` y `order_items` quedan con ESE tenant_id,
 * y el pedido no aparece cuando se consulta como el tenant base. (`order_eventos` lo escribe el CRM al
 * operar el pedido, no el Shop.) Datos inventados.
 */

const BASE = "tenant-base";
const NUEVO = "tenant-nuevo";

const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente1@cliente.example" };
const datos: DatosPedido = {
  contactoNombre: "Cliente de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "transferencia",
};

const linea: LineaCotizada = {
  id: "item-1",
  code: "COD-item-1",
  name: "Producto item-1",
  brand: "Marca",
  qty: 1,
  precioUnitario: 100,
  ivaPorcentaje: 21,
  subtotal: 100,
  iva: 21,
  total: 121,
  stockDisponible: null,
};
const cotizacion: Cotizacion = {
  lineas: [linea],
  subtotal: 100,
  iva: 21,
  costoEnvio: 0,
  total: 121,
  hayProblemas: false,
  listaPrivada: false,
};

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(
      sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts restart identity cascade`,
    );
  });
}

/** `order_items` no lleva tenant_id: hereda el del pedido (join por order_id). */
async function contarDe(tabla: "orders" | "order_items", tenant: string): Promise<number> {
  const consulta =
    tabla === "order_items"
      ? sql`select count(*)::int as n from shop.order_items i join shop.orders o on o.id = i.order_id where o.tenant_id = ${tenant}`
      : sql`select count(*)::int as n from ${sql.raw("shop." + tabla)} where tenant_id = ${tenant}`;
  const [f] = (await getDb().execute(consulta)) as unknown as { n: number }[];
  return f.n;
}

beforeEach(async () => {
  await limpiar();
  const db = getDb();
  for (const t of [BASE, NUEVO]) {
    await db.execute(
      sql`insert into public.tenants (id, name, logo_path, resend_from) values (${t}, ${"Tenant " + t}, '/logos/test.svg', 'test@cliente.example')`,
    );
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status) values (${t}, 'item-1', 'Producto item-1', 10, 'active')`,
    );
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("pedido en la tienda de un tenant nuevo", () => {
  it("queda con su tenant_id en pedido y líneas, y no aparece para el base", async () => {
    vi.stubEnv("SHOP_TENANT_ID", NUEVO);
    const { id } = await crearPedido(cliente, datos, cotizacion);
    expect(id).toBeTruthy();

    expect(await contarDe("orders", NUEVO)).toBe(1);
    expect(await contarDe("order_items", NUEVO)).toBe(1);

    // Como el tenant base: ni el pedido, ni las líneas, ni los eventos.
    expect(await contarDe("orders", BASE)).toBe(0);
    expect(await contarDe("order_items", BASE)).toBe(0);
  });
});

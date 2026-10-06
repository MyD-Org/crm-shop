import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crearPedido, getItemsParaAntifraude, getPedidoParaPago, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Datos del pedido para el control de fraude de Payway (Cybersource), contra Postgres REAL (local):
 * el contacto y la entrega congelados salen de `getPedidoParaPago` y las líneas de
 * `getItemsParaAntifraude` (sku = código o id de Alegra, total con IVA). Datos inventados.
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

beforeEach(async () => {
  await limpiar();
  await sembrar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("datos para el control de fraude", () => {
  it("el pedido trae contacto y entrega congelados y las líneas con sku y total con IVA", async () => {
    const p = await crearPedido(
      cliente,
      datos({ entregaTipo: "envio", entregaCiudad: "Mar del Plata", entregaDireccion: "Calle Falsa 123" }),
      cotizacion,
    );
    const ped = await getPedidoParaPago(p.id, { clerkUserId: "user_1" });
    expect(ped).toMatchObject({
      contactoNombre: "Cliente de Prueba",
      contactoTelefono: "1100000000",
      entregaTipo: "envio",
      entregaCiudad: "Mar del Plata",
      entregaDireccion: "Calle Falsa 123",
      total: 1210,
    });
    expect(await getItemsParaAntifraude(p.id)).toEqual([
      { sku: "COD-1", nombre: "Producto 1", cantidad: 1, total: 1210 },
    ]);
  });

  it("un pedido sin líneas devuelve una lista vacía", async () => {
    expect(await getItemsParaAntifraude("00000000-0000-4000-8000-000000000000")).toEqual([]);
  });
});

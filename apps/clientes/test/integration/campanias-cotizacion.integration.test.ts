import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { cotizar } from "@/lib/cotizacion";
import { crearPedido, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import { campaniasActivasEn } from "@/lib/campanias/vigentes";
import { assertLocalTestDb } from "./db-url";

/**
 * Cotización y pedido con campañas de precios (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md) contra Postgres real (local, datos inventados): el cobro
 * usa la misma regla que la exhibición, el pedido congela la campaña y un pedido creado durante la
 * campaña se recotiza con las campañas activas a la fecha de creación (decisión C de Emanuel).
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const CAMPANIA = "00000000-0000-4000-8000-0000000000c1";
const REGLA = "00000000-0000-4000-8000-0000000000e1";
const GENERAL = "00000000-0000-4000-8000-0000000000a1";
const TRANSF = "00000000-0000-4000-8000-0000000000a2";

const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente@cliente.example" };
const datos: DatosPedido = {
  contactoNombre: "Cliente de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "mercadopago",
};

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts restart identity cascade`);
  });
}

/** Campaña al 20 % (general 160 → 128, transferencia 130 → 104) con la ventana dada. */
async function sembrar(inicio: Date, fin: Date) {
  const db = getDb();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  await db.execute(
    sql`insert into public.campanias (id, tenant_id, nombre, etiqueta, inicio, fin)
        values (${CAMPANIA}, ${TENANT}, 'Black Friday', 'BF', ${inicio.toISOString()}::timestamptz, ${fin.toISOString()}::timestamptz)`,
  );
  const precios = [
    { idPriceList: GENERAL, name: "Tarjeta cuotas", price: 160, main: true },
    { idPriceList: TRANSF, name: "Efectivo o Transferencia", price: 130, main: false },
  ];
  const campanias = [
    {
      id: CAMPANIA,
      reglaId: REGLA,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      pct: 20,
      unidades: null,
      precios: [
        { idPriceList: GENERAL, price: 128 },
        { idPriceList: TRANSF, price: 104 },
      ],
    },
  ];
  await db.execute(
    sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online, campanias_online)
        values (${TENANT}, 'item-1', 'Producto 1', 10, 'active', 'active', 21, ${JSON.stringify(precios)}::jsonb, ${JSON.stringify(campanias)}::jsonb)`,
  );
}

const horas = (h: number) => new Date(Date.now() + h * 3_600_000);

beforeEach(async () => {
  await limpiar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("cotizar con campañas", () => {
  it("campaña activa: precio de campaña, normal y la campaña en la línea", async () => {
    await sembrar(horas(-1), horas(24));
    const c = await cotizar([{ id: "item-1", qty: 2 }], { campanias: await campaniasActivasEn(new Date()) });
    expect(c.lineas[0]).toMatchObject({
      precioUnitario: 128,
      precioNormal: 160,
      campaniaId: CAMPANIA,
      campaniaReglaId: REGLA,
      campaniaEtiqueta: "BF",
      subtotal: 256,
    });
  });

  it("sin campañas en el contexto: el precio de siempre y sin campaña", async () => {
    await sembrar(horas(-1), horas(24));
    const c = await cotizar([{ id: "item-1", qty: 1 }], {});
    expect(c.lineas[0].precioUnitario).toBe(160);
    expect(c.lineas[0].campaniaId).toBeUndefined();
  });

  it("terminada hace 10 minutos: con la fecha de creación del pedido rige (104 por transferencia); ahora, no (130)", async () => {
    await sembrar(horas(-24), new Date(Date.now() - 10 * 60_000));
    const creadoDurante = horas(-1);
    const durante = await cotizar([{ id: "item-1", qty: 1 }], { idListaMedio: TRANSF, campanias: await campaniasActivasEn(creadoDurante) });
    expect(durante.lineas[0].precioUnitario).toBe(104);
    const ahora = await cotizar([{ id: "item-1", qty: 1 }], { idListaMedio: TRANSF, campanias: await campaniasActivasEn(new Date()) });
    expect(ahora.lineas[0].precioUnitario).toBe(130);
  });
});

describe("cuentas con lista privada (decisión B: pagan el menor)", () => {
  const PRIVADA = "00000000-0000-4000-8000-0000000000b1";
  async function conPrivado(precio: number) {
    await getDb().execute(
      sql`update public.catalog_products set precios_online_privados = ${JSON.stringify([{ idPriceList: PRIVADA, name: "Instaladores", price: precio }])}::jsonb
          where tenant_id = ${TENANT} and alegra_id = 'item-1'`,
    );
  }

  it("privado 140 más caro que la campaña (128): cobra 128 y el normal es su privado", async () => {
    await sembrar(horas(-1), horas(24));
    await conPrivado(140);
    const c = await cotizar([{ id: "item-1", qty: 1 }], { idListaPrivada: PRIVADA, campanias: await campaniasActivasEn(new Date()) });
    expect(c.lineas[0]).toMatchObject({ precioUnitario: 128, precioNormal: 140, campaniaId: CAMPANIA });
  });

  it("privado 120 más barato: cobra su privado, sin campaña", async () => {
    await sembrar(horas(-1), horas(24));
    await conPrivado(120);
    const c = await cotizar([{ id: "item-1", qty: 1 }], { idListaPrivada: PRIVADA, campanias: await campaniasActivasEn(new Date()) });
    expect(c.lineas[0].precioUnitario).toBe(120);
    expect(c.lineas[0].campaniaId).toBeUndefined();
  });
});

describe("el pedido congela la campaña", () => {
  it("order_items guarda campania_id, campania_regla_id y precio_normal", async () => {
    await sembrar(horas(-1), horas(24));
    const c = await cotizar([{ id: "item-1", qty: 2 }], { campanias: await campaniasActivasEn(new Date()) });
    const { id } = await crearPedido(cliente, datos, c);
    const [fila] = (await getDb().execute(
      sql`select precio_unitario, precio_normal, campania_id, campania_regla_id from shop.order_items where order_id = ${id}`,
    )) as unknown as Record<string, string | null>[];
    expect(Number(fila.precio_unitario)).toBe(128);
    expect(Number(fila.precio_normal)).toBe(160);
    expect(fila.campania_id).toBe(CAMPANIA);
    expect(fila.campania_regla_id).toBe(REGLA);
  });
});

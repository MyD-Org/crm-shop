import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { cotizar } from "@/lib/cotizacion";
import { getProductosPorIds } from "@/lib/catalog";
import { SIN_MEDIOS_PRECIO } from "@/lib/medios-precio";
import { cambiarMedioPedido, crearPedido, type DatosCliente, type DatosPedido } from "@/lib/pedidos";
import { campaniasActivasEn } from "@/lib/campanias/vigentes";
import { UnidadesCampaniaError } from "@/lib/campanias/unidades";
import { assertLocalTestDb } from "./db-url";

/**
 * Límite de unidades a precio de campaña (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md) contra Postgres REAL (local, datos inventados): la carrera
 * por la última unidad, un pedido cancelado que la libera, el límite de un modelo compartido entre
 * sus variantes y la cotización (agotado = precio normal; más de lo que queda = problema).
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const CAMPANIA = "00000000-0000-4000-8000-0000000000c1";
const REGLA = "00000000-0000-4000-8000-0000000000e1";
const GENERAL = "00000000-0000-4000-8000-0000000000a1";

const cliente = (n: number): DatosCliente => ({ clerkUserId: `user_${n}`, email: `cliente${n}@cliente.example` });
const datos: DatosPedido = { contactoNombre: "Cliente", contactoTelefono: "1100000000", entregaTipo: "retiro", pagoMetodo: "transferencia" };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.order_items, shop.orders, shop.carts restart identity cascade`);
  });
}

/** Modelo con dos variantes (V1, V2) bajo UNA regla de campaña con límite `unidades`. */
async function sembrar(unidades: number) {
  const db = getDb();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  const ahora = Date.now();
  const inicio = new Date(ahora - 3_600_000).toISOString();
  const fin = new Date(ahora + 86_400_000).toISOString();
  await db.execute(
    sql`insert into public.campanias (id, tenant_id, nombre, etiqueta, inicio, fin) values (${CAMPANIA}, ${TENANT}, 'Apertura', 'Precio de apertura', ${inicio}::timestamptz, ${fin}::timestamptz)`,
  );
  const precios = [{ idPriceList: GENERAL, name: "Tarjeta cuotas", price: 160, main: true }];
  const campanias = [{ id: CAMPANIA, reglaId: REGLA, inicio, fin, pct: 20, unidades, precios: [{ idPriceList: GENERAL, price: 128 }] }];
  for (const id of ["V1", "V2"]) {
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online, campanias_online)
          values (${TENANT}, ${id}, ${`Producto ${id}`}, 50, 'active', 'active', 21, ${JSON.stringify(precios)}::jsonb, ${JSON.stringify(campanias)}::jsonb)`,
    );
  }
}

const activas = () => campaniasActivasEn(new Date());
const cotizarUna = async (id: string, qty: number) => cotizar([{ id, qty }], { campanias: await activas() });

beforeEach(async () => {
  await limpiar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("límite de unidades por regla de campaña", () => {
  it("límite 1 y dos compras simultáneas: se confirma una y la otra falla por unidades de campaña", async () => {
    await sembrar(1);
    const c = await cotizarUna("V1", 1);
    expect(c.lineas[0].campaniaReglaId).toBe(REGLA);
    const r = await Promise.allSettled([crearPedido(cliente(1), datos, c), crearPedido(cliente(2), datos, c)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const fallada = r.find((x): x is PromiseRejectedResult => x.status === "rejected")!;
    expect(fallada.reason).toBeInstanceOf(UnidadesCampaniaError);
    expect((fallada.reason as UnidadesCampaniaError).quedan).toBe(0);
  });

  it("un pedido cancelado libera su unidad", async () => {
    await sembrar(1);
    const { id } = await crearPedido(cliente(1), datos, await cotizarUna("V1", 1));
    await expect(crearPedido(cliente(2), datos, await cotizarUna("V1", 1).then((c) => ({ ...c, lineas: c.lineas.map((l) => ({ ...l, campaniaReglaId: REGLA })) })))).rejects.toBeInstanceOf(UnidadesCampaniaError);
    await getDb().execute(sql`update shop.orders set estado = 'cancelado', cancelacion_motivo = 'prueba' where id = ${id}`);
    await expect(crearPedido(cliente(3), datos, await cotizarUna("V1", 1))).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("el límite de un modelo se comparte entre sus variantes", async () => {
    await sembrar(2);
    await crearPedido(cliente(1), datos, await cotizarUna("V1", 1));
    await crearPedido(cliente(2), datos, await cotizarUna("V2", 1));
    const tercera = await cotizarUna("V1", 1);
    // Agotado: la cotización ya da el precio normal, sin campaña.
    expect(tercera.lineas[0]).toMatchObject({ precioUnitario: 160 });
    expect(tercera.lineas[0].campaniaId).toBeUndefined();
  });

  it("pedir más de lo que queda marca la línea y no se puede confirmar", async () => {
    await sembrar(2);
    await crearPedido(cliente(1), datos, await cotizarUna("V1", 1));
    const c = await cotizarUna("V2", 2);
    expect(c.lineas[0].problema).toBe("unidades_campania");
    expect(c.lineas[0].detalle).toBe("Queda 1 unidad a precio de apertura. Reduzca la cantidad para mantener el precio.");
    expect(c.hayProblemas).toBe(true);
  });

  it("la ficha sabe cuántas quedan y, agotada la regla, vuelve al precio normal", async () => {
    await sembrar(2);
    const leer = async () =>
      (await getProductosPorIds(["V1"], { mediosPrecio: { ...SIN_MEDIOS_PRECIO, campanias: await activas() } })).get("V1")!;
    await crearPedido(cliente(1), datos, await cotizarUna("V2", 1));
    expect((await leer()).campania).toMatchObject({ unidades: 2, quedan: 1 });
    await crearPedido(cliente(2), datos, await cotizarUna("V1", 1));
    const agotado = await leer();
    expect(agotado.campania).toBeUndefined();
    expect(agotado.price).toBe(160);
  });

  it("cambiar el medio de pago no puede sumarle a un pedido una unidad de campaña que ya no queda", async () => {
    await sembrar(1);
    await crearPedido(cliente(1), datos, await cotizarUna("V1", 1)); // se lleva la única unidad
    const normal = await cotizarUna("V2", 1); // ya agotada: precio normal, sin campaña
    expect(normal.lineas[0].campaniaReglaId).toBeUndefined();
    const b = await crearPedido(cliente(2), datos, normal);
    // Una cotización vieja (o adulterada) con la regla de campaña: la transacción la frena.
    const conCampania = { ...normal, lineas: normal.lineas.map((l) => ({ ...l, campaniaId: CAMPANIA, campaniaReglaId: REGLA, precioUnitario: 128 })) };
    await expect(
      cambiarMedioPedido(b.id, { clerkUserId: "user_2" }, { pagoMetodo: "mercadopago", cuotas: null, idPriceList: null, cotizacion: conCampania }),
    ).rejects.toBeInstanceOf(UnidadesCampaniaError);
  });

  it("cambiar el medio de un pedido que ya tiene la última unidad la conserva (no se cuenta a sí mismo)", async () => {
    await sembrar(1);
    const a = await crearPedido(cliente(1), datos, await cotizarUna("V1", 1));
    const recotizada = await cotizar([{ id: "V1", qty: 1 }], { campanias: await activas(), excluirPedidoId: a.id });
    await expect(
      cambiarMedioPedido(a.id, { clerkUserId: "user_1" }, { pagoMetodo: "mercadopago", cuotas: null, idPriceList: null, cotizacion: recotizada }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("al recotizar un pedido, sus propias unidades no cuentan (decisión C con la última unidad)", async () => {
    await sembrar(1);
    const { id } = await crearPedido(cliente(1), datos, await cotizarUna("V1", 1));
    const recotizada = await cotizar([{ id: "V1", qty: 1 }], { campanias: await activas(), excluirPedidoId: id });
    expect(recotizada.lineas[0]).toMatchObject({ precioUnitario: 128, campaniaReglaId: REGLA });
  });
});

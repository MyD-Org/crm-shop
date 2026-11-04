import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { elegibleParaAviso } from "@/lib/aviso-reingreso-elegibilidad";
import { contarPendientesPorEmail, insertarAviso, type FilaAviso } from "@/lib/aviso-reingreso-repo";
import type { SucursalDato } from "@/lib/sucursales";
import { assertLocalTestDb } from "./db-url";

/**
 * Avisos de reingreso (change `aviso-reingreso`, S1) contra Postgres REAL (local, datos inventados):
 * el único parcial (una pendiente por producto y email sin importar mayúsculas), que tras avisar o
 * dar de baja se pueda pedir de nuevo, el aislamiento por tenant, los CHECK de la tabla y la
 * verificación server-side de elegibilidad (agotado, inventariable, reservas, sucursales).
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const OTRO = "otro-tenant";

const fila = (o: Partial<FilaAviso> = {}): FilaAviso => ({
  tenantId: TENANT,
  alegraId: "P1",
  email: "ana@cliente.example",
  whatsapp: null,
  cantidad: 1,
  quiereEncargar: false,
  consentimientoContacto: false,
  clerkUserId: null,
  ...o,
});

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.avisos_reingreso, shop.order_items, shop.orders restart identity cascade`);
  });
}

const filasDe = async (alegraId = "P1", tenant = TENANT) =>
  (await getDb().execute(
    sql`select email, cantidad, quiere_encargar, whatsapp, avisado_at, unsubscribed_at from shop.avisos_reingreso where tenant_id = ${tenant} and alegra_id = ${alegraId} order by created_at`,
  )) as unknown as { email: string; cantidad: number; quiere_encargar: boolean; whatsapp: string | null }[];

beforeEach(async () => {
  await limpiar();
  await getDb().execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("insertarAviso", () => {
  it("un duplicado con otra capitalización es una sola fila pendiente (y actualiza cantidad/encargar)", async () => {
    const db = getDb();
    const a = await insertarAviso(db, fila({ email: "ana@cliente.example", cantidad: 1 }));
    const b = await insertarAviso(db, fila({ email: "ANA@Cliente.Example", cantidad: 5, quiereEncargar: true }));
    expect(a.creado).toBe(true);
    expect(b.creado).toBe(false);
    expect(b.id).toBe(a.id);
    const filas = await filasDe();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ cantidad: 5, quiere_encargar: true });
  });

  it("un duplicado sin WhatsApp no borra el que ya estaba", async () => {
    const db = getDb();
    await insertarAviso(db, fila({ quiereEncargar: true, consentimientoContacto: true, whatsapp: "1155550000" }));
    await insertarAviso(db, fila({ quiereEncargar: true }));
    expect((await filasDe())[0].whatsapp).toBe("1155550000");
  });

  it("tras avisar o dar de baja se crea una fila nueva", async () => {
    const db = getDb();
    await insertarAviso(db, fila());
    await db.execute(sql`update shop.avisos_reingreso set avisado_at = now()`);
    const b = await insertarAviso(db, fila());
    expect(b.creado).toBe(true);
    await db.execute(sql`update shop.avisos_reingreso set unsubscribed_at = now() where avisado_at is null`);
    const c = await insertarAviso(db, fila());
    expect(c.creado).toBe(true);
    expect(await filasDe()).toHaveLength(3);
  });

  it("aislamiento por tenant: el mismo producto y email en otro tenant es otra fila", async () => {
    const db = getDb();
    await insertarAviso(db, fila());
    const otra = await insertarAviso(db, fila({ tenantId: OTRO }));
    expect(otra.creado).toBe(true);
    expect(await filasDe("P1", TENANT)).toHaveLength(1);
    expect(await filasDe("P1", OTRO)).toHaveLength(1);
    expect(await contarPendientesPorEmail(db, TENANT, "ana@cliente.example")).toBe(1);
  });

  it("el WhatsApp sin consentimiento viola el CHECK de la tabla", async () => {
    await expect(insertarAviso(getDb(), fila({ whatsapp: "1155550000", consentimientoContacto: false }))).rejects.toThrow();
  });

  it("cantidad fuera de 1..999 viola el CHECK de la tabla", async () => {
    await expect(insertarAviso(getDb(), fila({ cantidad: 0 }))).rejects.toThrow();
    await expect(insertarAviso(getDb(), fila({ cantidad: 1000 }))).rejects.toThrow();
  });

  it("dos altas simultáneas del mismo aviso dejan una sola fila", async () => {
    const db = getDb();
    await Promise.all([insertarAviso(db, fila()), insertarAviso(db, fila({ email: "ANA@cliente.example" }))]);
    expect(await filasDe()).toHaveLength(1);
  });
});

describe("contarPendientesPorEmail (tope por email)", () => {
  it("cuenta solo pendientes, de cualquier producto, sin importar mayúsculas", async () => {
    const db = getDb();
    for (let i = 1; i <= 10; i++) await insertarAviso(db, fila({ alegraId: `P${i}` }));
    expect(await contarPendientesPorEmail(db, TENANT, "Ana@cliente.example")).toBe(10);
    await db.execute(sql`update shop.avisos_reingreso set avisado_at = now() where alegra_id = 'P1'`);
    await db.execute(sql`update shop.avisos_reingreso set unsubscribed_at = now() where alegra_id = 'P2'`);
    expect(await contarPendientesPorEmail(db, TENANT, "ana@cliente.example")).toBe(8);
    expect(await contarPendientesPorEmail(db, OTRO, "ana@cliente.example")).toBe(0);
  });
});

describe("elegibleParaAviso", () => {
  const sucursal = (slug: string, orden: number, predeterminada = false): SucursalDato => ({
    slug,
    aceptaRetiro: true,
    aceptaEnvio: true,
    envioCiudades: [],
    orden,
    activa: true,
    predeterminada,
  });
  const DOS = [sucursal("igz", 1, true), sucursal("mdp", 2)];

  async function producto(id: string, stock: number | null, extra: { status?: string; precio?: number } = {}) {
    const precios = [{ idPriceList: "1", name: "General", price: extra.precio ?? 100, main: true }];
    await getDb().execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online)
          values (${TENANT}, ${id}, ${`Producto ${id}`}, ${stock}, ${extra.status ?? "active"}, ${extra.status ?? "active"}, 21, ${JSON.stringify(precios)}::jsonb)`,
    );
  }
  const sinModalidades = { modalidades: [] as never[] };

  it("sin sucursales: agotado se acepta; con stock se rechaza", async () => {
    await producto("A", 0);
    await producto("B", 4);
    expect(await elegibleParaAviso("A", { sucursales: [], ...sinModalidades })).toEqual({ ok: true });
    expect(await elegibleParaAviso("B", { sucursales: [], ...sinModalidades })).toEqual({ ok: false, motivo: "con_disponible" });
  });

  it("stock NULL (no inventariable) y producto inexistente se rechazan", async () => {
    await producto("N", null);
    expect(await elegibleParaAviso("N", { sucursales: [], ...sinModalidades })).toEqual({ ok: false, motivo: "no_inventariable" });
    expect(await elegibleParaAviso("NOEXISTE", { sucursales: [], ...sinModalidades })).toEqual({ ok: false, motivo: "no_existe" });
  });

  it("inactivo en Alegra y sin precio se rechazan", async () => {
    await producto("I", 0, { status: "inactive" });
    await producto("S", 0, { precio: 0 });
    expect(await elegibleParaAviso("I", { sucursales: [], ...sinModalidades })).toEqual({ ok: false, motivo: "no_existe" });
    expect(await elegibleParaAviso("S", { sucursales: [], ...sinModalidades })).toEqual({ ok: false, motivo: "no_comprable" });
  });

  it("lo reservado por pedidos vivos no cuenta como disponible", async () => {
    await producto("R", 1);
    await getDb().execute(sql`
      insert into shop.orders (tenant_id, clerk_user_id, cliente_email, contacto_nombre, contacto_telefono, entrega_tipo, pago_metodo,
                               subtotal, iva, total, estado, pago_estado, reserva_vence_en)
      values (${TENANT}, 'user_x', 'x@cliente.example', 'Cliente', '1100000000', 'retiro', 'transferencia', 100, 21, 121,
              'pendiente', 'pendiente', now() + interval '1 day')`);
    const [{ id }] = (await getDb().execute(sql`select id from shop.orders limit 1`)) as unknown as { id: string }[];
    await getDb().execute(sql`
      insert into shop.order_items (order_id, alegra_item_id, name, qty, precio_unitario, iva_porcentaje, subtotal, iva, total)
      values (${id}, 'R', 'Producto R', 1, 100, 21, 100, 21, 121)`);
    expect(await elegibleParaAviso("R", { sucursales: [], ...sinModalidades })).toEqual({ ok: true });
  });

  it("con sucursales: suma el disponible de todas las vendibles", async () => {
    await producto("M", 0);
    await getDb().execute(
      sql`insert into public.sucursales (tenant_id, slug, nombre) values (${TENANT}, 'igz', 'Iguazú'), (${TENANT}, 'mdp', 'Mar del Plata')`,
    );
    await getDb().execute(
      sql`insert into public.catalog_stock_sucursal (tenant_id, sucursal, alegra_id, stock, origen) values (${TENANT}, 'igz', 'M', 0, 'manual'), (${TENANT}, 'mdp', 'M', 3, 'manual')`,
    );
    expect(await elegibleParaAviso("M", { sucursales: DOS, ...sinModalidades })).toEqual({ ok: false, motivo: "con_disponible" });
    await getDb().execute(sql`update public.catalog_stock_sucursal set stock = 0 where alegra_id = 'M'`);
    expect(await elegibleParaAviso("M", { sucursales: DOS, ...sinModalidades })).toEqual({ ok: true });
  });

  it("una modalidad de venta sin stock activa pero sin asignar al producto no cambia nada", async () => {
    await producto("V", 0);
    const modalidad = { id: "00000000-0000-4000-8000-0000000000m1", texto: "A pedido", plazoDias: 5, flujo: "a_confirmar" as const };
    // Sin fila de overlay que la asigne, la modalidad no aplica al producto.
    expect(await elegibleParaAviso("V", { sucursales: DOS, modalidades: [modalidad] })).toEqual({ ok: true });
  });
});

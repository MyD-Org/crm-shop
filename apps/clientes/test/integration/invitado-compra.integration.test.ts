import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contarPendientesInvitado,
  crearPedido,
  getPedido,
  getPedidoInvitadoPorClave,
  registrarCobro,
  type DatosCliente,
  type DatosPedido,
} from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Compra de invitado (change `compra-como-invitado`, S2a) contra Postgres REAL (local, datos
 * inventados): el pedido nace de invitado y sin dueño, el tope de pendientes por email, el reintento
 * idempotente que exige el mismo email, y la medición server-side de `pedido_confirmado` al registrar
 * el cobro (una sola vez por pedido, aunque el aviso del procesador llegue dos veces; nunca para quien
 * tiene cuenta). El webhook / la conciliación llaman a `registrarCobro` sin identidad ni token.
 */

const medir = vi.fn();
// `cache()` de React memoiza por request con los argumentos; fuera de un request no memoiza nada. Acá se
// lo reemplaza por un memoizador por argumentos para probar que la clave incluye la llave del invitado.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <F extends (...a: never[]) => unknown>(fn: F): F => {
    const memo = new Map<string, unknown>();
    return ((...a: unknown[]) => {
      const k = JSON.stringify(a);
      if (!memo.has(k)) memo.set(k, (fn as unknown as (...x: unknown[]) => unknown)(...a));
      return memo.get(k);
    }) as unknown as F;
  },
}));
vi.mock("@/lib/tracking/servidor", () => ({
  medirPedidoConfirmadoInvitado: async (...a: unknown[]) => {
    medir(...a);
  },
}));
vi.mock("@/lib/pedido-avisos", async (original) => ({
  ...(await original<typeof import("@/lib/pedido-avisos")>()),
  avisarCobro: async () => undefined,
}));

const TENANT = process.env.SHOP_TENANT_ID!;
const OTRO_TENANT = "tenant-otro";

const linea: LineaCotizada = {
  id: "item-1", code: "COD-1", name: "Producto 1", brand: "Marca", qty: 1, precioUnitario: 1000,
  ivaPorcentaje: 21, subtotal: 1000, iva: 210, total: 1210, stockDisponible: null,
};
const cotizacion: Cotizacion = { lineas: [linea], subtotal: 1000, iva: 210, costoEnvio: 0, total: 1210, hayProblemas: false, listaPrivada: false, flujo: "normal" };

const invitado = (email: string): DatosCliente => ({ clerkUserId: null, email, compraInvitado: true });
const conCuenta: DatosCliente = { clerkUserId: "user_ana", email: "ana@cliente.example" };
const datos = (extra: Partial<DatosPedido> = {}): DatosPedido => ({
  contactoNombre: "Comprador de Prueba",
  contactoTelefono: "1100000000",
  entregaTipo: "retiro",
  pagoMetodo: "mercadopago",
  ...extra,
});

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.pago_intentos, shop.order_items, shop.orders, shop.carts restart identity cascade`);
  });
}

async function sembrar() {
  const db = getDb();
  await db.execute(sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`);
  await db.execute(sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status) values (${TENANT}, 'item-1', 'Producto 1', 100, 'active')`);
}

type Fila = { compra_invitado: boolean; clerk_user_id: string | null; cliente_codigo: string | null; cliente_email: string | null; pago_estado: string };
async function fila(id: string): Promise<Fila> {
  const [f] = (await getDb().execute(
    sql`select compra_invitado, clerk_user_id, cliente_codigo, cliente_email, pago_estado from shop.orders where id = ${id}`,
  )) as unknown as Fila[];
  return f;
}

const cobro = (referencia = "ref-1") => ({
  proveedor: "mercadopago", referencia, estado: "pagado" as const, detalle: "accredited", medio: "tarjeta", cuotas: 1, totalPagado: 1210,
});

beforeEach(async () => {
  medir.mockClear();
  await limpiar();
  await sembrar();
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("crearPedido: compra de invitado", () => {
  it("el pedido nace de invitado, sin cuenta ni cliente vinculado, con el email normalizado", async () => {
    const { id } = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    expect(await fila(id)).toMatchObject({
      compra_invitado: true,
      clerk_user_id: null,
      cliente_codigo: null,
      cliente_email: "ana@cliente.example",
    });
  });

  it("un pedido con cuenta NO es de invitado (el default de siempre)", async () => {
    const { id } = await crearPedido(conCuenta, datos(), cotizacion);
    expect(await fila(id)).toMatchObject({ compra_invitado: false, clerk_user_id: "user_ana" });
  });
});

describe("contarPendientesInvitado: el tope por email", () => {
  const SIN_VENTANA = new Date(Date.now() - 24 * 60 * 60_000);

  it("cuenta los pendientes del email (sin distinguir mayúsculas) y nada más", async () => {
    await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await crearPedido(invitado("otra@cliente.example"), datos(), cotizacion);
    await crearPedido(conCuenta, datos(), cotizacion);
    expect(await contarPendientesInvitado("ana@cliente.example", SIN_VENTANA)).toBe(2);
    expect(await contarPendientesInvitado("otra@cliente.example", SIN_VENTANA)).toBe(1);
    expect(await contarPendientesInvitado("nadie@cliente.example", SIN_VENTANA)).toBe(0);
    // El email se guarda normalizado, pero la comparación es por lower(): un registro viejo en mayúsculas cuenta igual.
    await getDb().execute(sql`update shop.orders set cliente_email = 'ANA@Cliente.example' where cliente_email = 'ana@cliente.example'`);
    expect(await contarPendientesInvitado("ana@cliente.example", SIN_VENTANA)).toBe(2);
  });

  it("no cuenta los pagados, los cancelados, los ya reclamados por una cuenta, los vinculados ni los de otro tenant", async () => {
    const a = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    const b = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    const c = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    const d = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    const e = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion); // este sí cuenta
    await getDb().execute(sql`update shop.orders set pago_estado = 'pagado' where id = ${a.id}`);
    await getDb().execute(sql`update shop.orders set estado = 'cancelado', cancelacion_motivo = 'cliente' where id = ${b.id}`);
    await getDb().execute(sql`update shop.orders set clerk_user_id = 'user_ana' where id = ${c.id}`);
    await getDb().execute(sql`update shop.orders set cliente_codigo = 'C-100' where id = ${d.id}`);
    await getDb().execute(sql`update shop.orders set tenant_id = ${OTRO_TENANT} where id = ${e.id}`);
    expect(await contarPendientesInvitado("ana@cliente.example", SIN_VENTANA)).toBe(1);
  });

  it("sólo cuenta los de la ventana (24 h por defecto)", async () => {
    const viejo = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await getDb().execute(sql`update shop.orders set created_at = now() - interval '25 hours' where id = ${viejo.id}`);
    expect(await contarPendientesInvitado("ana@cliente.example")).toBe(1);
    expect(await contarPendientesInvitado("ana@cliente.example", new Date(Date.now() - 48 * 60 * 60_000))).toBe(2);
  });
});

describe("getPedidoInvitadoPorClave: el reintento idempotente", () => {
  const CLAVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("devuelve el pedido sólo con la misma clave Y el mismo email (sin distinguir mayúsculas)", async () => {
    const { id } = await crearPedido(invitado("ana@cliente.example"), datos({ idempotencyKey: CLAVE }), cotizacion);
    expect(await getPedidoInvitadoPorClave(CLAVE, "ana@cliente.example")).toMatchObject({ id });
    expect(await getPedidoInvitadoPorClave(CLAVE, "otra@cliente.example")).toBeNull();
    expect(await getPedidoInvitadoPorClave("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ana@cliente.example")).toBeNull();
  });

  it("no abre un pedido con cuenta, uno ya reclamado, uno vinculado ni uno de otro tenant", async () => {
    const cuenta = await crearPedido(conCuenta, datos({ idempotencyKey: CLAVE }), cotizacion);
    expect(await getPedidoInvitadoPorClave(CLAVE, "ana@cliente.example")).toBeNull();

    await getDb().execute(sql`update shop.orders set compra_invitado = true where id = ${cuenta.id}`);
    expect(await getPedidoInvitadoPorClave(CLAVE, "ana@cliente.example")).toBeNull(); // clerk_user_id no nulo

    await getDb().execute(sql`update shop.orders set clerk_user_id = null, cliente_codigo = 'C-100' where id = ${cuenta.id}`);
    expect(await getPedidoInvitadoPorClave(CLAVE, "ana@cliente.example")).toBeNull();

    await getDb().execute(sql`update shop.orders set cliente_codigo = null where id = ${cuenta.id}`);
    expect(await getPedidoInvitadoPorClave(CLAVE, "ana@cliente.example")).toMatchObject({ id: cuenta.id });

    await getDb().execute(sql`update shop.orders set tenant_id = ${OTRO_TENANT} where id = ${cuenta.id}`);
    expect(await getPedidoInvitadoPorClave(CLAVE, "ana@cliente.example")).toBeNull();
  });

  it("crearPedido con la misma clave devuelve el mismo pedido (el índice único es la garantía)", async () => {
    const a = await crearPedido(invitado("ana@cliente.example"), datos({ idempotencyKey: CLAVE }), cotizacion);
    const b = await crearPedido(invitado("ana@cliente.example"), datos({ idempotencyKey: CLAVE }), cotizacion);
    expect(b).toMatchObject({ id: a.id, repetido: true });
  });
});

describe("registrarCobro: medición server-side de pedido_confirmado", () => {
  it("pedido de invitado que pasa a pagado: UNA medición con id, total y medio (sin datos personales)", async () => {
    const { id } = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    expect(await registrarCobro(id, cobro(), { avisar: false })).toBe(true);
    expect((await fila(id)).pago_estado).toBe("pagado");
    expect(medir).toHaveBeenCalledTimes(1);
    expect(medir).toHaveBeenCalledWith({ pedidoId: id, total: 1210, medio: "mercadopago" });
    expect(JSON.stringify(medir.mock.calls)).not.toContain("cliente.example");
  });

  it("el mismo aviso del procesador dos veces (webhook + respuesta directa) mide una sola vez", async () => {
    const { id } = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await registrarCobro(id, cobro(), { avisar: false });
    await registrarCobro(id, cobro(), { avisar: false });
    await registrarCobro(id, cobro("ref-2"), { avisar: false });
    expect(medir).toHaveBeenCalledTimes(1);
  });

  it("un cobro que NO acredita (pendiente / rechazado) no mide", async () => {
    const { id } = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await registrarCobro(id, { ...cobro(), estado: "pendiente" as const }, { avisar: false });
    await registrarCobro(id, { ...cobro("ref-2"), estado: "fallido" as const }, { avisar: false });
    expect(medir).not.toHaveBeenCalled();
  });

  it("el pedido de una cuenta no se mide acá (lo mide el navegador al crearlo)", async () => {
    const { id } = await crearPedido(conCuenta, datos(), cotizacion);
    await registrarCobro(id, cobro(), { avisar: false });
    expect(medir).not.toHaveBeenCalled();
  });

  it("un pedido de invitado que se reclamó antes de pagar sigue midiéndose (la compra fue de invitado)", async () => {
    const { id } = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await getDb().execute(sql`update shop.orders set clerk_user_id = 'user_ana' where id = ${id}`);
    await registrarCobro(id, cobro(), { avisar: false });
    expect(medir).toHaveBeenCalledTimes(1);
  });

  it("el webhook no necesita identidad ni token: registrarCobro no consulta ninguna sesión", async () => {
    // Si `registrarCobro` llamara a `identidadActual()` (que lee cookies de Next) fuera de un request, esto fallaría.
    const { id } = await crearPedido(invitado("ana@cliente.example"), datos(), cotizacion);
    await expect(registrarCobro(id, cobro(), { avisar: false })).resolves.toBe(true);
  });
});

describe("getPedido (memoizado por request): la clave de la caché incluye la llave del invitado", () => {
  it("el pedido que un token abrió no se sirve después a otro token ni a nadie sin llave", async () => {
    const pa = await crearPedido(invitado("a@cliente.example"), datos(), cotizacion);
    const pb = await crearPedido(invitado("b@cliente.example"), datos(), cotizacion);
    // Calienta la caché con la llave correcta.
    expect((await getPedido(pa.id, { clerkUserId: null, invitadoOrderId: pa.id }))?.id).toBe(pa.id);
    // Misma llamada otra vez: la memoizada, correcta.
    expect((await getPedido(pa.id, { clerkUserId: null, invitadoOrderId: pa.id }))?.id).toBe(pa.id);
    // Otro invitado o ninguna llave sobre el MISMO pedido: nada, aunque el primero ya esté en la caché.
    expect(await getPedido(pa.id, { clerkUserId: null, invitadoOrderId: pb.id })).toBeNull();
    expect(await getPedido(pa.id, { clerkUserId: null })).toBeNull();
    expect(await getPedido(pa.id, { clerkUserId: "user_ana" })).toBeNull();
  });

  it("tras reclamarlo una cuenta, la llave de invitado deja de abrirlo (y la cuenta lo abre)", async () => {
    const pa = await crearPedido(invitado("a@cliente.example"), datos(), cotizacion);
    await getDb().execute(sql`update shop.orders set clerk_user_id = 'user_ana' where id = ${pa.id}`);
    // Otra "request": llave idéntica pero la base ya cambió => el SQL manda (la caché es por request).
    expect(await getPedido(pa.id, { clerkUserId: "user_ana" })).not.toBeNull();
    expect(await getPedido(pa.id, { clerkUserId: null, invitadoOrderId: `${pa.id}` })).toBeNull();
  });
});

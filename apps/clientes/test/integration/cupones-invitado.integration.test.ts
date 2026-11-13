import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { CuponCanjeError, leerPromocionCupon, motivoCuentaCupon, reservarCanjeEnTx, type QuienCupon } from "@/lib/cupones/repo";
import type { PromocionCupon } from "@/lib/cupones/tipos";
import { assertLocalTestDb } from "./db-url";

/**
 * Cupones del invitado (change `compra-como-invitado`, S2a) contra Postgres REAL (local, datos
 * inventados): sin cuenta de la tienda las reglas de la persona se aplican por EMAIL normalizado, sin
 * comparar nunca `clerk_user_id = NULL`; el canje se serializa por email; y quien no es invitado y no
 * tiene cuenta sigue viendo `sin_sesion`.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const P_GENERICA = "00000000-0000-4000-8000-00000000c002";
const P_UNICOS = "00000000-0000-4000-8000-00000000c001";

const invitado = (email: string): QuienCupon => ({ clerkUserId: null, email, listaPrivada: false, invitado: true });
const ana: QuienCupon = { clerkUserId: "user_ana", email: "ana@cliente.example", listaPrivada: false };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.cupon_canjes, shop.order_items, shop.orders restart identity cascade`);
  });
}

async function promo(id: string, o: { tipo?: string; primera?: boolean; prefijo?: string | null } = {}) {
  await getDb().execute(sql`
    insert into public.cupon_promociones (id, tenant_id, nombre, tipo, pct, inicio, fin, prefijo, solo_primera_compra, creado_por)
    values (${id}, ${TENANT}, 'Promo', ${o.tipo ?? "unicos"}, 10, now() - interval '1 day', now() + interval '30 days',
            ${o.prefijo === undefined ? "LUZ" : o.prefijo}, ${o.primera ?? false}, 'test')`);
}

async function codigo(promocionId: string, texto: string) {
  await getDb().execute(sql`insert into public.cupon_codigos (promocion_id, tenant_id, codigo, origen) values (${promocionId}, ${TENANT}, ${texto}, 'manual')`);
}

async function pedido(o: { email: string; clerk?: string | null; estado?: string; pago?: string }): Promise<string> {
  const [r] = (await getDb().execute(sql`
    insert into shop.orders (tenant_id, clerk_user_id, cliente_email, contacto_nombre, contacto_telefono, entrega_tipo, pago_metodo,
                             subtotal, iva, total, estado, pago_estado, reserva_vence_en, compra_invitado)
    values (${TENANT}, ${o.clerk ?? null}, ${o.email}, 'Cliente', '1100000000', 'retiro', 'transferencia', 100, 21, 121,
            ${o.estado ?? "pendiente"}, ${o.pago ?? "pendiente"}, now() + interval '1 day', ${!o.clerk})
    returning id`)) as unknown as { id: string }[];
  return r.id;
}

const leer = async (texto: string) => (await leerPromocionCupon(texto.toUpperCase().replace(/[^A-Z0-9]/g, "")))!;
const canje = (p: PromocionCupon, q: QuienCupon, pedidoId: string) =>
  getDb().transaction((tx) => reservarCanjeEnTx(tx, p, q, pedidoId, 100));

beforeEach(async () => {
  await limpiar();
  await getDb().execute(sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`);
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("motivoCuentaCupon: invitado", () => {
  it("el invitado con email puede usar un cupón (antes siempre sin_sesion)", async () => {
    await promo(P_UNICOS);
    await codigo(P_UNICOS, "LUZ-AAAAA");
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-AAAAA"), invitado("nuevo@cliente.example"))).toBeNull();
  });

  it("sin la marca de invitado, quien no tiene cuenta sigue viendo sin_sesion (aunque tenga email)", async () => {
    await promo(P_UNICOS);
    await codigo(P_UNICOS, "LUZ-AAAAA");
    const sinMarca: QuienCupon = { clerkUserId: null, email: "x@cliente.example", listaPrivada: false };
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-AAAAA"), sinMarca)).toBe("sin_sesion");
  });

  it("invitado sin email: sin_sesion (no hay con qué identificarlo)", async () => {
    await promo(P_UNICOS);
    await codigo(P_UNICOS, "LUZ-AAAAA");
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-AAAAA"), { clerkUserId: null, email: null, listaPrivada: false, invitado: true })).toBe("sin_sesion");
  });

  it("«una vez por cliente» (genérica) con el mismo email, sin distinguir mayúsculas => usado; otro email => libre", async () => {
    await promo(P_GENERICA, { tipo: "generica", prefijo: null });
    await codigo(P_GENERICA, "BIENVENIDA");
    const p = await leer("BIENVENIDA");
    await canje(p, invitado("ana@cliente.example"), await pedido({ email: "ana@cliente.example" }));
    expect(await motivoCuentaCupon(getDb(), p, invitado("ANA@Cliente.example"))).toBe("usado");
    expect(await motivoCuentaCupon(getDb(), p, invitado("otro@cliente.example"))).toBeNull();
  });

  it("el canje de un invitado queda con clerk_user_id NULL y su email", async () => {
    await promo(P_GENERICA, { tipo: "generica", prefijo: null });
    await codigo(P_GENERICA, "BIENVENIDA");
    await canje(await leer("BIENVENIDA"), invitado("Ana@Cliente.example"), await pedido({ email: "ana@cliente.example" }));
    const [k] = (await getDb().execute(sql`select clerk_user_id, email from shop.cupon_canjes`)) as unknown as { clerk_user_id: string | null; email: string }[];
    expect(k).toEqual({ clerk_user_id: null, email: "ana@cliente.example" });
  });

  it("primera compra: un pedido comprado del mismo email (como invitado o con cuenta) lo impide", async () => {
    await promo(P_UNICOS, { primera: true });
    await codigo(P_UNICOS, "LUZ-AAAAA");
    const p = await leer("LUZ-AAAAA");
    expect(await motivoCuentaCupon(getDb(), p, invitado("ana@cliente.example"))).toBeNull();
    await pedido({ email: "ana@cliente.example", pago: "pagado" });
    expect(await motivoCuentaCupon(getDb(), p, invitado("ana@cliente.example"))).toBe("no_primera_compra");
    // Una cuenta con el mismo email también cuenta la compra del invitado.
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBe("no_primera_compra");
    expect(await motivoCuentaCupon(getDb(), p, invitado("otro@cliente.example"))).toBeNull();
  });

  it("primera compra: un cupón de primera compra vivo del mismo email frena abrir otro pendiente con otro código", async () => {
    await promo(P_UNICOS, { primera: true });
    await codigo(P_UNICOS, "LUZ-AAAAA");
    await codigo(P_UNICOS, "LUZ-BBBBB");
    const a = await leer("LUZ-AAAAA");
    await canje(a, invitado("ana@cliente.example"), await pedido({ email: "ana@cliente.example" }));
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-BBBBB"), invitado("ana@cliente.example"))).toBe("no_primera_compra");
  });

  it("lista privada sigue ganando (un invitado no la tiene, pero el orden de reglas no cambia)", async () => {
    await promo(P_UNICOS);
    await codigo(P_UNICOS, "LUZ-AAAAA");
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-AAAAA"), { ...invitado("a@cliente.example"), listaPrivada: true })).toBe("lista_privada");
  });
});

describe("reservarCanjeEnTx: el mismo email, dos checkouts a la vez", () => {
  it("de un cupón genérico «una vez por cliente», sólo gana uno; el otro recibe CuponCanjeError(usado)", async () => {
    await promo(P_GENERICA, { tipo: "generica", prefijo: null });
    await codigo(P_GENERICA, "BIENVENIDA");
    const p = await leer("BIENVENIDA");
    const p1 = await pedido({ email: "ana@cliente.example" });
    const p2 = await pedido({ email: "ana@cliente.example" });
    const resultados = await Promise.allSettled([canje(p, invitado("ana@cliente.example"), p1), canje(p, invitado("ana@cliente.example"), p2)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const fallo = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(fallo.reason).toBeInstanceOf(CuponCanjeError);
    expect((fallo.reason as CuponCanjeError).motivo).toBe("usado");
    const [n] = (await getDb().execute(sql`select count(*)::int as n from shop.cupon_canjes`)) as unknown as { n: number }[];
    expect(n.n).toBe(1);
  });

  it("un invitado sin email no puede reservar un canje (sin_sesion)", async () => {
    await promo(P_UNICOS);
    await codigo(P_UNICOS, "LUZ-AAAAA");
    const err = await canje(await leer("LUZ-AAAAA"), { clerkUserId: null, email: null, listaPrivada: false, invitado: true }, await pedido({ email: "a@cliente.example" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CuponCanjeError);
    expect((err as CuponCanjeError).motivo).toBe("sin_sesion");
  });
});

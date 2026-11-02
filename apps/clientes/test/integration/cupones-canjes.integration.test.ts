import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  CuponCanjeError,
  leerPromocionCupon,
  liberarCanjeEnTx,
  motivoCuentaCupon,
  reservarCanjeEnTx,
  resolverCupon,
  type QuienCupon,
} from "@/lib/cupones/repo";
import type { PromocionCupon } from "@/lib/cupones/tipos";
import { assertLocalTestDb } from "./db-url";

/**
 * Canjes de cupones (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md, "Shop: dueño
 * de los canjes") contra Postgres REAL (local, datos inventados): el estado se calcula desde el pedido
 * (vivo / comprado / liberado), primera compra por cuenta y por email, límite y la carrera por un
 * código único.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const P_UNICOS = "00000000-0000-4000-8000-00000000c001";
const P_GENERICA = "00000000-0000-4000-8000-00000000c002";
const P_OTRA = "00000000-0000-4000-8000-00000000c003";

const ana: QuienCupon = { clerkUserId: "user_ana", email: "ana@cliente.example", listaPrivada: false };
const beto: QuienCupon = { clerkUserId: "user_beto", email: "beto@cliente.example", listaPrivada: false };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.cupon_canjes, shop.order_items, shop.orders restart identity cascade`);
  });
}

async function promo(id: string, o: { tipo?: string; limite?: number | null; primera?: boolean; prefijo?: string | null } = {}) {
  await getDb().execute(sql`
    insert into public.cupon_promociones (id, tenant_id, nombre, tipo, pct, inicio, fin, prefijo, solo_primera_compra, limite_canjes, creado_por)
    values (${id}, ${TENANT}, 'Promo', ${o.tipo ?? "unicos"}, 10, now() - interval '1 day', now() + interval '30 days',
            ${o.prefijo === undefined ? "LUZ" : o.prefijo}, ${o.primera ?? true}, ${o.limite ?? null}, 'test')`);
}

async function codigo(promocionId: string, texto: string): Promise<string> {
  const [r] = (await getDb().execute(sql`
    insert into public.cupon_codigos (promocion_id, tenant_id, codigo, origen) values (${promocionId}, ${TENANT}, ${texto}, 'manual') returning id`)) as unknown as { id: string }[];
  return r.id;
}

type EstadoPedido = { estado?: string; pago?: string; vence?: string | null; quien?: QuienCupon; email?: string };
async function pedido(o: EstadoPedido = {}): Promise<string> {
  const q = o.quien ?? ana;
  const [r] = (await getDb().execute(sql`
    insert into shop.orders (tenant_id, clerk_user_id, cliente_email, contacto_nombre, contacto_telefono, entrega_tipo, pago_metodo,
                             subtotal, iva, total, estado, pago_estado, reserva_vence_en, cancelacion_motivo)
    values (${TENANT}, ${q.clerkUserId}, ${o.email ?? q.email}, 'Cliente', '1100000000', 'retiro', 'transferencia', 100, 21, 121,
            ${o.estado ?? "pendiente"}, ${o.pago ?? "pendiente"},
            ${o.vence === undefined ? sql`now() + interval '1 day'` : o.vence === null ? null : sql`${o.vence}::timestamptz`},
            ${o.estado === "cancelado" ? "cliente" : null})
    returning id`)) as unknown as { id: string }[];
  return r.id;
}

async function canje(p: PromocionCupon, q: QuienCupon, pedidoId: string) {
  await getDb().transaction((tx) => reservarCanjeEnTx(tx, p, q, pedidoId, 242));
}

const leer = async (texto: string) => (await leerPromocionCupon(texto.toUpperCase().replace(/[^A-Z0-9]/g, "")))!;

beforeEach(async () => {
  await limpiar();
  await getDb().execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  await promo(P_UNICOS);
  await promo(P_GENERICA, { tipo: "generica", prefijo: null, primera: false, limite: 1 });
  await promo(P_OTRA, { prefijo: "OTRA" });
  await codigo(P_UNICOS, "LUZ-7KQ2M");
  await codigo(P_UNICOS, "LUZ-AAAAA");
  await codigo(P_GENERICA, "APERTURA10");
  await codigo(P_OTRA, "OTRA-BBBBB");
});
afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("leerPromocionCupon / resolverCupon", () => {
  it("encuentra el código escrito de otra forma y mapea la vista", async () => {
    const p = await leer("luz 7kq2m");
    expect(p).toMatchObject({ codigo: "LUZ-7KQ2M", promocionId: P_UNICOS, tipo: "unicos", pct: 10, soloPrimeraCompra: true, activa: true, minimo: null });
    const r = await resolverCupon("luz 7kq2m", ana);
    expect(r).toMatchObject({ ok: true, motivoCuenta: null, verificado: true });
  });

  it("vacío = null; inexistente = no_existe; invitado = sin verificar", async () => {
    expect(await resolverCupon("", ana)).toBeNull();
    expect(await resolverCupon(undefined, ana)).toBeNull();
    expect(await resolverCupon("NOEXISTE", ana)).toMatchObject({ ok: false, error: { motivo: "no_existe" } });
    expect(await resolverCupon("ab", ana)).toMatchObject({ ok: false, error: { motivo: "no_existe" } });
    expect(await resolverCupon("LUZ-7KQ2M", null)).toMatchObject({ ok: true, verificado: false, motivoCuenta: null });
  });

  it("la vista ilegible da no_disponible, no una excepción", async () => {
    await getDb().execute(sql`alter view public.cupones_shop rename to cupones_shop_x`);
    try {
      expect(await resolverCupon("LUZ-7KQ2M", ana)).toEqual({
        ok: false,
        error: { motivo: "no_disponible", mensaje: "No pudimos validar el cupón. Inténtelo de nuevo en un momento." },
      });
    } finally {
      await getDb().execute(sql`alter view public.cupones_shop_x rename to cupones_shop`);
    }
  });
});

describe("motivoCuentaCupon", () => {
  it("sin sesión de la tienda y lista privada", async () => {
    const p = await leer("LUZ-7KQ2M");
    expect(await motivoCuentaCupon(getDb(), p, { clerkUserId: null, email: "x@cliente.example", listaPrivada: false })).toBe("sin_sesion");
    expect(await motivoCuentaCupon(getDb(), p, { ...ana, listaPrivada: true })).toBe("lista_privada");
  });

  it("código único usado por un pedido con reserva viva; liberado si vence o se cancela", async () => {
    const p = await leer("LUZ-7KQ2M");
    const id = await pedido({ quien: beto });
    await canje(p, beto, id);
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBe("usado");
    await getDb().execute(sql`update shop.orders set reserva_vence_en = now() - interval '1 minute' where id = ${id}`);
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBeNull();
    await getDb().execute(sql`update shop.orders set reserva_vence_en = now() + interval '1 day', estado = 'cancelado', cancelacion_motivo = 'cliente' where id = ${id}`);
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBeNull();
  });

  it("reserva 'infinity' pendiente: sigue usado; pagado: usado aunque la reserva venza", async () => {
    const p = await leer("LUZ-7KQ2M");
    const id = await pedido({ quien: beto, vence: "infinity" });
    await canje(p, beto, id);
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBe("usado");
    await getDb().execute(sql`update shop.orders set reserva_vence_en = now() - interval '1 day', pago_estado = 'pagado' where id = ${id}`);
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBe("usado");
  });

  it("primera compra: pedido pagado de la cuenta o del mismo email en otras mayúsculas; uno vencido no cuenta", async () => {
    const p = await leer("LUZ-7KQ2M");
    const vencido = await pedido({ vence: new Date(Date.now() - 60_000).toISOString() });
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBeNull();
    await getDb().execute(sql`update shop.orders set pago_estado = 'pagado' where id = ${vencido}`);
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBe("no_primera_compra");
    await limpiarPedidos();
    await pedido({ quien: beto, email: "ANA@Cliente.Example", estado: "entregado" });
    expect(await motivoCuentaCupon(getDb(), p, ana)).toBe("no_primera_compra");
  });

  it("primera compra: otro pedido vivo con otro cupón de primera compra", async () => {
    const otra = await leer("OTRA-BBBBB");
    const id = await pedido();
    await canje(otra, ana, id);
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-7KQ2M"), ana)).toBe("no_primera_compra");
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-AAAAA"), ana)).toBe("no_primera_compra");
    expect(await motivoCuentaCupon(getDb(), await leer("LUZ-7KQ2M"), ana, id)).toBeNull();
  });

  it("genérica: una por cuenta y límite total", async () => {
    const g = await leer("APERTURA10");
    const id = await pedido({ quien: beto });
    await canje(g, beto, id);
    expect(await motivoCuentaCupon(getDb(), g, beto)).toBe("usado");
    expect(await motivoCuentaCupon(getDb(), g, ana)).toBe("agotado");
    await getDb().transaction((tx) => liberarCanjeEnTx(tx, id));
    expect(await motivoCuentaCupon(getDb(), g, ana)).toBeNull();
  });
});

describe("reservarCanjeEnTx", () => {
  it("dos checkouts simultáneos con el mismo código único: uno inserta, el otro usado", async () => {
    const p = await leer("LUZ-7KQ2M");
    const [a, b] = [await pedido(), await pedido({ quien: beto })];
    const r = await Promise.allSettled([canje(p, ana, a), canje(p, beto, b)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const fallada = r.find((x): x is PromiseRejectedResult => x.status === "rejected")!;
    expect(fallada.reason).toBeInstanceOf(CuponCanjeError);
    expect((fallada.reason as CuponCanjeError).motivo).toBe("usado");
    const [{ n }] = (await getDb().execute(sql`select count(*)::int as n from shop.cupon_canjes`)) as unknown as { n: number }[];
    expect(n).toBe(1);
  });

  it("guarda quién, el descuento y el pedido", async () => {
    const p = await leer("LUZ-7KQ2M");
    const id = await pedido();
    await canje(p, ana, id);
    const [f] = (await getDb().execute(sql`select * from shop.cupon_canjes`)) as unknown as Record<string, unknown>[];
    expect(f).toMatchObject({ tenant_id: TENANT, codigo_id: p.codigoId, promocion_id: P_UNICOS, order_id: id, clerk_user_id: "user_ana", email: "ana@cliente.example", descuento_total: "242.00" });
  });
});

async function limpiarPedidos() {
  await getDb().execute(sql`delete from shop.orders`);
}

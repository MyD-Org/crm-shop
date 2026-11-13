import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { avisarPagoPendiente, pedidosConAvisoPagoPendiente } from "@/lib/pedido-avisos";
import { getPedido, getPedidoParaLink } from "@/lib/pedidos";
import { reclamarPedidosInvitado } from "@/lib/reclamo-invitado";
import { assertLocalTestDb } from "./db-url";

/**
 * Post-compra del invitado (change `compra-como-invitado`, S3) contra Postgres REAL (local, datos
 * inventados): reclamo idempotente por email verificado y aviso único «pendiente de pago».
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const DIA = 24 * 60 * 60_000;
const enviarEmail = vi.fn();
vi.mock("@/lib/marca", () => ({ getMarca: async () => ({ nombre: "Tienda Demo" }) }));
vi.mock("@/lib/email", () => ({ enviarEmail: (...a: unknown[]) => enviarEmail(...a) }));

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.pago_intentos, shop.order_items, shop.orders restart identity cascade`);
  });
}

async function pedido(o: {
  email?: string;
  invitado?: boolean;
  clerk?: string | null;
  cliente?: string | null;
  tenant?: string;
  estado?: string;
  pagoEstado?: string;
  metodo?: string;
  hace?: number;
}): Promise<string> {
  const hace = new Date(Date.now() - (o.hace ?? 5 * DIA));
  const [r] = (await getDb().execute(sql`
    insert into shop.orders (tenant_id, clerk_user_id, cliente_codigo, cliente_email, contacto_nombre, contacto_telefono,
                             entrega_tipo, pago_metodo, subtotal, iva, total, estado, pago_estado, compra_invitado, created_at,
                             cancelacion_motivo)
    values (${o.tenant ?? TENANT}, ${o.clerk ?? null}, ${o.cliente ?? null}, ${o.email ?? "ana@cliente.example"},
            'Ana', '1100000000', 'retiro', ${o.metodo ?? "mercadopago"}, 100, 21, 121, ${o.estado ?? "pendiente"},
            ${o.pagoEstado ?? "pendiente"}, ${o.invitado ?? true}, ${hace.toISOString()}::timestamptz,
            ${o.estado === "cancelado" ? "Cancelado por el cliente." : null})
    returning id`)) as unknown as { id: string }[];
  return r.id;
}

const dueno = async (id: string) =>
  ((await getDb().execute(sql`select clerk_user_id, aviso_pago_pendiente_en from shop.orders where id = ${id}`)) as unknown as {
    clerk_user_id: string | null;
    aviso_pago_pendiente_en: Date | null;
  }[])[0];

beforeAll(() => assertLocalTestDb(process.env.DATABASE_URL || ""));
beforeEach(async () => {
  await limpiar();
  enviarEmail.mockReset().mockResolvedValue({ ok: true });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tienda.cliente.example");
  vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

describe("reclamarPedidosInvitado", () => {
  it("asocia los pedidos de hace 5 y 20 días del mismo email (sin importar mayúsculas)", async () => {
    const a = await pedido({ hace: 5 * DIA, email: "Ana@Cliente.example" });
    const b = await pedido({ hace: 20 * DIA });
    const ids = await reclamarPedidosInvitado(TENANT, "user_ana", "ANA@cliente.example");
    expect(ids.sort()).toEqual([a, b].sort());
    expect((await dueno(a)).clerk_user_id).toBe("user_ana");
    expect((await getPedido(a, { clerkUserId: "user_ana" }))?.id).toBe(a);
  });

  it("no reclama: 45 días, cancelado, otro email, otro tenant, ya con cuenta/cliente, no invitado", async () => {
    const viejo = await pedido({ hace: 45 * DIA });
    const cancelado = await pedido({ estado: "cancelado" });
    const otro = await pedido({ email: "otra@cliente.example" });
    const otroTenant = await pedido({ tenant: "tenant-otro" });
    const conCuenta = await pedido({ clerk: "user_otro" });
    const conCliente = await pedido({ cliente: "C-1" });
    const noInvitado = await pedido({ invitado: false });
    expect(await reclamarPedidosInvitado(TENANT, "user_ana", "ana@cliente.example")).toEqual([]);
    for (const id of [viejo, cancelado, otro, otroTenant, noInvitado]) expect((await dueno(id)).clerk_user_id).toBeNull();
    expect((await dueno(conCuenta)).clerk_user_id).toBe("user_otro");
    expect((await dueno(conCliente)).clerk_user_id).toBeNull();
  });

  it("sin email (no verificado => no se llama con él) no reclama nada", async () => {
    const id = await pedido({});
    expect(await reclamarPedidosInvitado(TENANT, "user_ana", null)).toEqual([]);
    expect(await reclamarPedidosInvitado(TENANT, "user_ana", "  ")).toEqual([]);
    expect((await dueno(id)).clerk_user_id).toBeNull();
  });

  it("es idempotente y un pedido nuevo con el mismo email se reclama en la próxima corrida", async () => {
    const a = await pedido({});
    expect(await reclamarPedidosInvitado(TENANT, "user_ana", "ana@cliente.example")).toEqual([a]);
    expect(await reclamarPedidosInvitado(TENANT, "user_ana", "ana@cliente.example")).toEqual([]);
    const b = await pedido({ hace: 60_000 });
    expect(await reclamarPedidosInvitado(TENANT, "user_ana", "ana@cliente.example")).toEqual([b]);
    // otra cuenta con el mismo email no le saca lo que ya es de Ana
    expect(await reclamarPedidosInvitado(TENANT, "user_otra", "ana@cliente.example")).toEqual([]);
    expect((await dueno(a)).clerk_user_id).toBe("user_ana");
  });
});

describe("getPedidoParaLink", () => {
  it("pendiente en línea => disponible; pagado => pagado; el resto => no_disponible", async () => {
    expect(await getPedidoParaLink(await pedido({ hace: 60_000 }))).toBe("disponible");
    expect(await getPedidoParaLink(await pedido({ pagoEstado: "pagado", hace: 60_000 }))).toBe("pagado");
    expect(await getPedidoParaLink(await pedido({ estado: "cancelado", hace: 60_000 }))).toBe("no_disponible");
    expect(await getPedidoParaLink(await pedido({ hace: 3 * DIA }))).toBe("no_disponible");
    expect(await getPedidoParaLink(await pedido({ metodo: "transferencia", hace: 60_000 }))).toBe("no_disponible");
    expect(await getPedidoParaLink("11111111-1111-4111-8111-111111111111")).toBe("no_disponible");
  });

  it("pedido con cuenta, reclamado, de otro tenant o sin compra_invitado => no_disponible", async () => {
    expect(await getPedidoParaLink(await pedido({ clerk: "user_1", hace: 60_000 }))).toBe("no_disponible");
    expect(await getPedidoParaLink(await pedido({ tenant: "tenant-otro", hace: 60_000 }))).toBe("no_disponible");
    expect(await getPedidoParaLink(await pedido({ invitado: false, hace: 60_000 }))).toBe("no_disponible");
  });
});

describe("aviso único «pendiente de pago»", () => {
  const MIN = 60_000;

  it("sólo los pedidos de invitado con pago en línea pendiente de entre 30 min y 24 h", async () => {
    const ok = await pedido({ hace: 31 * MIN });
    await pedido({ hace: 10 * MIN }); // todavía no
    await pedido({ hace: 30 * 60 * MIN }); // pasada la ventana
    await pedido({ hace: 31 * MIN, metodo: "transferencia" });
    await pedido({ hace: 31 * MIN, clerk: "user_1" });
    await pedido({ hace: 31 * MIN, invitado: false });
    await pedido({ hace: 31 * MIN, pagoEstado: "pagado" });
    await pedido({ hace: 31 * MIN, estado: "cancelado" });
    expect(await pedidosConAvisoPagoPendiente()).toEqual([ok]);
  });

  it("manda UN mail con «Pagar su pedido», marca la columna y no reenvía", async () => {
    const id = await pedido({ hace: 31 * MIN });
    expect(await avisarPagoPendiente(id)).toBe(true);
    expect(await avisarPagoPendiente(id)).toBe(false);
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    const mail = enviarEmail.mock.calls[0][0] as { to: string; subject: string; html: string; idempotencyKey: string };
    expect(mail.to).toBe("ana@cliente.example");
    expect(mail.subject).toContain("pendiente de pago");
    expect(mail.html).toContain("Pagar su pedido");
    expect(mail.html).toContain("/pagar/v1.");
    expect(mail.html).not.toContain("Ver mis pedidos");
    expect((await dueno(id)).aviso_pago_pendiente_en).not.toBeNull();
    expect(await pedidosConAvisoPagoPendiente()).toEqual([]);
  });

  it("dos corridas concurrentes: sólo una avisa", async () => {
    const id = await pedido({ hace: 31 * MIN });
    const r = await Promise.all([avisarPagoPendiente(id), avisarPagoPendiente(id)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(enviarEmail).toHaveBeenCalledTimes(1);
  });

  it("un pedido que se pagó o se reclamó en el medio no recibe el aviso", async () => {
    const pagado = await pedido({ hace: 31 * MIN });
    await getDb().execute(sql`update shop.orders set pago_estado = 'pagado' where id = ${pagado}`);
    const reclamado = await pedido({ hace: 31 * MIN });
    await reclamarPedidosInvitado(TENANT, "user_ana", "ana@cliente.example");
    expect(await avisarPagoPendiente(pagado)).toBe(false);
    expect(await avisarPagoPendiente(reclamado)).toBe(false);
    expect(enviarEmail).not.toHaveBeenCalled();
  });
});

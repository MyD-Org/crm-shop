import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  cancelarPedidoPendiente,
  esPedidoPropio,
  getPedido,
  getPedidoParaComprobante,
  getPedidoParaPago,
  intentoAbiertoDelPedido,
  listarPedidos,
  pedidoParaCambiarMedio,
  pedidoPendienteMasReciente,
  resumenPedidos,
  type DuenoPedidos,
} from "@/lib/pedidos";
import { assertLocalTestDb } from "./db-url";

/**
 * Matriz de aislamiento de la TERCERA llave de `esDeSuDueno` (change `compra-como-invitado`, S1),
 * contra Postgres REAL (local, datos inventados). El token firmado ya lo verificó
 * `invitado-acceso.ts`; lo que se prueba acá es que, aun con un token válido, la consulta sólo abre
 * el pedido de invitado, sin dueño y del tenant, que el token nombra.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const OTRO_TENANT = "tenant-otro";

let PA: string; // invitado, sin dueño
let PB: string; // invitado, sin dueño (otra persona)
let PC: string; // con cuenta Clerk, no es de invitado
let PD: string; // era de invitado y ya se reclamó (clerk_user_id)
let PE: string; // de invitado pero con cliente vinculado
let PF: string; // sin ninguna llave de dueño y SIN compra_invitado (histórico)
let PO: string; // invitado de OTRO tenant

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.pago_intentos, shop.order_items, shop.orders restart identity cascade`);
  });
}

async function pedido(o: {
  tenant?: string;
  clerk?: string | null;
  cliente?: string | null;
  invitado: boolean;
  email?: string;
}): Promise<string> {
  const [r] = (await getDb().execute(sql`
    insert into shop.orders (tenant_id, clerk_user_id, cliente_codigo, cliente_email, contacto_nombre, contacto_telefono,
                             entrega_tipo, pago_metodo, subtotal, iva, total, estado, pago_estado, compra_invitado)
    values (${o.tenant ?? TENANT}, ${o.clerk ?? null}, ${o.cliente ?? null}, ${o.email ?? "comprador@cliente.example"},
            'Comprador', '1100000000', 'retiro', 'transferencia', 100, 21, 121, 'pendiente', 'pendiente', ${o.invitado})
    returning id`)) as unknown as { id: string }[];
  return r.id;
}

beforeAll(() => {
  assertLocalTestDb(process.env.DATABASE_URL || "");
});

beforeEach(async () => {
  await limpiar();
  PA = await pedido({ invitado: true, email: "a@cliente.example" });
  PB = await pedido({ invitado: true, email: "b@cliente.example" });
  PC = await pedido({ invitado: false, clerk: "user_ana" });
  PD = await pedido({ invitado: true, clerk: "user_ana" });
  PE = await pedido({ invitado: true, cliente: "C-100" });
  PF = await pedido({ invitado: false });
  PO = await pedido({ invitado: true, tenant: OTRO_TENANT });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

const invitado = (orderId: string): DuenoPedidos => ({ clerkUserId: null, invitadoOrderId: orderId });
const ninguna: DuenoPedidos = { clerkUserId: null };

describe("esDeSuDueno: tercera llave", () => {
  it("la llave del invitado abre SU pedido", async () => {
    expect((await getPedido(PA, invitado(PA)))?.id).toBe(PA);
    expect(await esPedidoPropio(PA, invitado(PA))).toBe(true);
    expect((await getPedidoParaPago(PA, invitado(PA)))?.id).toBe(PA);
    expect(await pedidoParaCambiarMedio(PA, invitado(PA))).not.toBeNull();
  });

  it("sin ninguna llave => nada (ni el pedido de invitado)", async () => {
    for (const id of [PA, PB, PC, PD, PE, PF, PO]) {
      expect(await getPedido(id, ninguna), id).toBeNull();
      expect(await esPedidoPropio(id, ninguna), id).toBe(false);
    }
  });

  it("la llave de PA sobre PB => denegado, y PB no cambia", async () => {
    expect(await getPedido(PB, invitado(PA))).toBeNull();
    expect(await esPedidoPropio(PB, invitado(PA))).toBe(false);
    expect(await getPedidoParaPago(PB, invitado(PA))).toBeNull();
    expect(await pedidoParaCambiarMedio(PB, invitado(PA))).toBeNull();
    expect(await intentoAbiertoDelPedido(PB, invitado(PA))).toBeNull();
    const [b] = (await getDb().execute(sql`select estado, pago_estado, clerk_user_id from shop.orders where id = ${PB}`)) as unknown as {
      estado: string;
      pago_estado: string;
      clerk_user_id: string | null;
    }[];
    expect(b).toEqual({ estado: "pendiente", pago_estado: "pendiente", clerk_user_id: null });
  });

  it("pedido con cuenta (clerk_user_id) inaccesible con la llave de invitado", async () => {
    expect(await getPedido(PC, invitado(PC))).toBeNull();
    expect(await getPedido(PD, invitado(PD))).toBeNull(); // ya reclamado
    expect(await esPedidoPropio(PD, invitado(PD))).toBe(false);
  });

  it("pedido con cliente vinculado (cliente_codigo) inaccesible con la llave de invitado", async () => {
    expect(await getPedido(PE, invitado(PE))).toBeNull();
    expect(await esPedidoPropio(PE, invitado(PE))).toBe(false);
  });

  it("pedido sin compra_invitado (histórico) inaccesible con la llave de invitado", async () => {
    expect(await getPedido(PF, invitado(PF))).toBeNull();
    expect(await getPedidoParaPago(PF, invitado(PF))).toBeNull();
  });

  it("otro tenant: ni siquiera con el id exacto", async () => {
    expect(await getPedido(PO, invitado(PO))).toBeNull();
    expect(await esPedidoPropio(PO, invitado(PO))).toBe(false);
  });

  it("un id que no existe responde igual que uno ajeno", async () => {
    const inexistente = "99999999-9999-4999-8999-999999999999";
    expect(await getPedido(inexistente, invitado(inexistente))).toBeNull();
    expect(await getPedido(PB, invitado(PA))).toBeNull();
  });

  it("la sesión conserva su acceso, y la llave de invitado no se lo achica ni se lo agranda", async () => {
    const ana: DuenoPedidos = { clerkUserId: "user_ana" };
    expect((await getPedido(PC, ana))?.id).toBe(PC);
    expect((await getPedido(PD, ana))?.id).toBe(PD);
    expect(await getPedido(PA, ana)).toBeNull();
    // Mezclar las llaves no abre otro pedido de invitado.
    expect(await getPedido(PB, { ...ana, invitadoOrderId: PA })).toBeNull();
    expect((await getPedido(PA, { ...ana, invitadoOrderId: PA }))?.id).toBe(PA);
  });

  it("cliente vinculado conserva el suyo", async () => {
    expect((await getPedido(PE, { clerkUserId: null, clienteCodigo: "C-100" }))?.id).toBe(PE);
  });
});

describe("las listas ignoran la llave del invitado", () => {
  it("listarPedidos / resumenPedidos / pedidoPendienteMasReciente => vacío para un invitado", async () => {
    expect(await listarPedidos(invitado(PA))).toEqual([]);
    expect(await resumenPedidos(invitado(PA))).toMatchObject({ pedidosEsteAnio: 0, enCurso: 0, compradoEsteAnio: 0 });
    expect(await pedidoPendienteMasReciente(invitado(PA), ["transferencia"])).toBeNull();
  });

  it("una sesión sigue listando sólo lo suyo", async () => {
    const lista = await listarPedidos({ clerkUserId: "user_ana", invitadoOrderId: PA });
    expect(lista.map((p) => p.id).sort()).toEqual([PC, PD].sort());
  });
});

describe("el invitado no cancela ni sube comprobante (A3, D8)", () => {
  it("cancelarPedidoPendiente con la llave de invitado => null y el pedido sigue pendiente", async () => {
    expect(await cancelarPedidoPendiente(PA, invitado(PA))).toBeNull();
    const [a] = (await getDb().execute(sql`select estado from shop.orders where id = ${PA}`)) as unknown as { estado: string }[];
    expect(a.estado).toBe("pendiente");
  });

  it("getPedidoParaComprobante con la llave de invitado => null", async () => {
    expect(await getPedidoParaComprobante(PA, invitado(PA))).toBeNull();
  });
});

describe("migración 0045 (S1-1)", () => {
  it("los pedidos anteriores quedan con compra_invitado = false y se listan igual", async () => {
    const [h] = (await getDb().execute(sql`
      insert into shop.orders (tenant_id, clerk_user_id, cliente_email, contacto_nombre, contacto_telefono, entrega_tipo, pago_metodo, subtotal, iva, total)
      values (${TENANT}, 'user_hist', 'hist@cliente.example', 'Histórico', '1100000000', 'retiro', 'transferencia', 100, 21, 121)
      returning id, compra_invitado, aviso_pago_pendiente_en`)) as unknown as {
      id: string;
      compra_invitado: boolean;
      aviso_pago_pendiente_en: Date | null;
    }[];
    expect(h.compra_invitado).toBe(false);
    expect(h.aviso_pago_pendiente_en).toBeNull();
    expect((await listarPedidos({ clerkUserId: "user_hist" })).map((p) => p.id)).toEqual([h.id]);
  });

  it("el índice parcial existe y sólo cubre pedidos de invitado sin dueño", async () => {
    const [i] = (await getDb().execute(sql`
      select indexdef from pg_indexes where schemaname = 'shop' and indexname = 'orders_invitado_email_idx'`)) as unknown as {
      indexdef: string;
    }[];
    expect(i.indexdef).toMatch(/lower\(cliente_email\)/);
    expect(i.indexdef).toMatch(/compra_invitado/);
    expect(i.indexdef).toMatch(/clerk_user_id IS NULL/);
    expect(i.indexdef).toMatch(/cliente_codigo IS NULL/);
  });
});

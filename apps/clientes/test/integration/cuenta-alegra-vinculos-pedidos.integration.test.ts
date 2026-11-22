import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  crearPedido,
  esPedidoPropio,
  getPedido,
  listarPedidos,
  type DatosCliente,
  type DatosPedido,
  type DuenoPedidos,
} from "@/lib/pedidos";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion";
import { assertLocalTestDb } from "./db-url";

/**
 * Change `shop-contactos-alegra-mdp`, rebanadas S3 (0047, vínculos por cuenta) y S4 (0048, pedido con
 * cuenta) contra Postgres REAL (local, datos inventados). Los ids de Alegra no son únicos entre
 * cuentas: el contacto "123" de `principal` y el "123" de `mdp` son empresas distintas.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
type Fila = Record<string, unknown>;
const q = async (c: ReturnType<typeof sql>) => (await getDb().execute(c)) as unknown as Fila[];

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(
      sql`truncate table public.tenants, shop.client_links, shop.link_otps, shop.order_items, shop.orders, shop.carts restart identity cascade`,
    );
  });
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  await limpiar();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

// --- S3: 0047 ----------------------------------------------------------------------------------------

const vinculo = (usuario: string, contacto: string, cuenta: string | null, estado = "activa") =>
  cuenta === null
    ? getDb().execute(sql`
        insert into shop.client_links (clerk_user_id, alegra_contact_id, estado, metodo)
        values (${usuario}, ${contacto}, ${estado}, 'email_verificado')`)
    : getDb().execute(sql`
        insert into shop.client_links (clerk_user_id, alegra_contact_id, estado, metodo, alegra_account)
        values (${usuario}, ${contacto}, ${estado}, 'email_verificado', ${cuenta})`);

describe("0047 client_links / link_otps por cuenta", () => {
  it("las filas sin cuenta quedan en principal (default), en client_links y link_otps", async () => {
    await vinculo("user_a", "123", null);
    await getDb().execute(sql`
      insert into shop.link_otps (clerk_user_id, alegra_contact_id, code_hash, destino_masked, expires_at)
      values ('user_a', '123', 'hash', 'c***@cliente.example', now() + interval '10 minutes')`);
    const [l] = await q(sql`select alegra_account from shop.client_links`);
    const [o] = await q(sql`select alegra_account from shop.link_otps`);
    expect(l.alegra_account).toBe("principal");
    expect(o.alegra_account).toBe("principal");
  });

  it("mientras exista cl_user_activa, un usuario tiene una sola activa en total", async () => {
    await vinculo("user_a", "123", "principal");
    await expect(vinculo("user_a", "789", "principal")).rejects.toThrow();
    // El índice viejo (una activa por usuario) sigue vivo hasta la migración que lo borra (S5).
    await expect(vinculo("user_a", "123", "mdp")).rejects.toThrow();
    // Revocados no cuentan para la unicidad.
    await expect(vinculo("user_a", "999", "mdp", "revocada")).resolves.toBeDefined();
  });

  it("conviven el índice viejo y el nuevo, los dos parciales", async () => {
    const idx = await q(sql`
      select indexname, indexdef from pg_indexes
      where schemaname = 'shop' and tablename = 'client_links' and indexname in ('cl_user_activa', 'cl_user_cuenta_activa')
      order by indexname`);
    expect(idx.map((i) => i.indexname)).toEqual(["cl_user_activa", "cl_user_cuenta_activa"]);
    expect(String(idx[0].indexdef)).toMatch(/UNIQUE INDEX .*\(clerk_user_id\) WHERE \(estado = 'activa'::text\)/);
    expect(String(idx[1].indexdef)).toMatch(/UNIQUE INDEX .*\(clerk_user_id, alegra_account\) WHERE \(estado = 'activa'::text\)/);
  });

  it("el ON CONFLICT del código anterior a S3 (sólo usuario) sigue funcionando", async () => {
    await vinculo("user_d", "123", null);
    const r = await getDb().execute(sql`
      insert into shop.client_links (clerk_user_id, alegra_contact_id, estado, metodo)
      values ('user_d', '456', 'activa', 'email_verificado')
      on conflict ("clerk_user_id") where "estado" = 'activa' do nothing
      returning id`);
    expect(r.length).toBe(0);
  });

  it("el CHECK rechaza una cuenta con formato inválido", async () => {
    await expect(vinculo("user_b", "1", "MDP")).rejects.toThrow();
    await expect(vinculo("user_b", "1", "-mdp")).rejects.toThrow();
    await expect(vinculo("user_b", "1", "")).rejects.toThrow();
    await expect(vinculo("user_b", "1", "mar-del-plata")).resolves.toBeDefined();
  });

  it("onConflict del Shop (usuario, cuenta) absorbe la carrera del mismo usuario en la misma cuenta", async () => {
    await vinculo("user_c", "123", "mdp");
    const r = await getDb().execute(sql`
      insert into shop.client_links (clerk_user_id, alegra_contact_id, estado, metodo, alegra_account)
      values ('user_c', '123', 'activa', 'email_verificado', 'mdp')
      on conflict ("clerk_user_id", "alegra_account") where "estado" = 'activa' do nothing
      returning id`);
    expect((r as unknown as Fila[]).length).toBe(0);
  });
});

// --- S4: 0048 + esDeSuDueno -------------------------------------------------------------------------

async function pedidoCrudo(o: { clerk?: string | null; cliente?: string | null; cuenta?: string | null }): Promise<string> {
  const [r] =
    o.cuenta === undefined || o.cuenta === null
      ? await q(sql`
          insert into shop.orders (tenant_id, clerk_user_id, cliente_codigo, cliente_email, contacto_nombre, contacto_telefono,
                                   entrega_tipo, pago_metodo, subtotal, iva, total)
          values (${TENANT}, ${o.clerk ?? null}, ${o.cliente ?? null}, 'comprador@cliente.example', 'Comprador', '1100000000',
                  'retiro', 'transferencia', 100, 21, 121)
          returning id`)
      : await q(sql`
          insert into shop.orders (tenant_id, clerk_user_id, cliente_codigo, cliente_cuenta, cliente_email, contacto_nombre,
                                   contacto_telefono, entrega_tipo, pago_metodo, subtotal, iva, total)
          values (${TENANT}, ${o.clerk ?? null}, ${o.cliente ?? null}, ${o.cuenta}, 'comprador@cliente.example', 'Comprador',
                  '1100000000', 'retiro', 'transferencia', 100, 21, 121)
          returning id`);
  return String(r.id);
}

describe("0048 orders.cliente_cuenta", () => {
  it("un pedido sin cuenta (código viejo / histórico) queda en principal", async () => {
    const id = await pedidoCrudo({ clerk: "user_hist", cliente: "123" });
    const [f] = await q(sql`select cliente_cuenta from shop.orders where id = ${id}`);
    expect(f.cliente_cuenta).toBe("principal");
  });

  it("el CHECK rechaza una cuenta con formato inválido", async () => {
    await expect(pedidoCrudo({ cliente: "1", cuenta: "Mdp" })).rejects.toThrow();
    await expect(pedidoCrudo({ cliente: "1", cuenta: "mdp" })).resolves.toBeTruthy();
  });
});

describe("esDeSuDueno filtra el código del cliente por la cuenta del despliegue", () => {
  let deIgz: string; // principal, cliente 123, otro usuario de Clerk
  let deMdp: string; // mdp, cliente 123
  let propio: string; // del usuario de Clerk, hecho en principal y sin cliente

  beforeEach(async () => {
    deIgz = await pedidoCrudo({ clerk: "user_igz", cliente: "123" });
    deMdp = await pedidoCrudo({ clerk: "user_mdp", cliente: "123", cuenta: "mdp" });
    propio = await pedidoCrudo({ clerk: "user_mdp" });
  });

  const vinculadoMdp: DuenoPedidos = { clerkUserId: "user_mdp_2", clienteCodigo: "123" };

  it("en mdp, el vinculado al 123 de mdp NO ve el pedido del 123 de principal (lista, detalle, propio)", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    expect((await listarPedidos(vinculadoMdp)).map((p) => p.id)).toEqual([deMdp]);
    expect(await getPedido(deIgz, vinculadoMdp)).toBeNull();
    expect(await esPedidoPropio(deIgz, vinculadoMdp)).toBe(false);
    expect((await getPedido(deMdp, vinculadoMdp))?.id).toBe(deMdp);
  });

  it("en principal (default), el vinculado al 123 ve sólo los de principal, como siempre", async () => {
    expect((await listarPedidos(vinculadoMdp)).map((p) => p.id)).toEqual([deIgz]);
    expect(await getPedido(deMdp, vinculadoMdp)).toBeNull();
  });

  it("la llave de Clerk no depende de la cuenta: el usuario ve sus pedidos propios en cualquier despliegue", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    const ids = (await listarPedidos({ clerkUserId: "user_mdp" })).map((p) => p.id).sort();
    expect(ids).toEqual([deMdp, propio].sort());
  });
});

describe("crearPedido guarda la cuenta del despliegue", () => {
  const cliente: DatosCliente = { clerkUserId: "user_1", email: "cliente1@cliente.example", codigo: "123" };
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
    flujo: "normal",
  };

  beforeEach(async () => {
    const db = getDb();
    await db.execute(
      sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant test', '/logos/test.svg', 'test@cliente.example')`,
    );
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status) values (${TENANT}, 'item-1', 'Producto item-1', 10, 'active')`,
    );
  });

  it("default: principal", async () => {
    const { id } = await crearPedido(cliente, datos, cotizacion);
    const [f] = await q(sql`select cliente_codigo, cliente_cuenta from shop.orders where id = ${id}`);
    expect(f).toEqual({ cliente_codigo: "123", cliente_cuenta: "principal" });
  });

  it("SHOP_CUENTA_ALEGRA=mdp: mdp", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    const { id } = await crearPedido(cliente, datos, cotizacion);
    const [f] = await q(sql`select cliente_codigo, cliente_cuenta from shop.orders where id = ${id}`);
    expect(f).toEqual({ cliente_codigo: "123", cliente_cuenta: "mdp" });
  });
});

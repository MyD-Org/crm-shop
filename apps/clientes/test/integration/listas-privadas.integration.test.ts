import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { listaMapeada, listaPrivadaDeContacto } from "@/lib/lista-cuenta-repo";
import { preciosPrivados } from "@/lib/precios-privados-repo";
import { assertLocalTestDb } from "./db-url";

/**
 * Lista privada de un contacto y sus precios, contra Postgres REAL (local) con las vistas de la
 * migración 0068 del CRM. Datos inventados. Cubre la clave (tenant, cuenta, id de lista de Alegra),
 * que contado/sin lista/sin enlace caen al precio público (`null`) y que un id sin precio es `null`
 * ("Consulte") y nunca 0.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const OTRO_TENANT = "tenant-ajeno";
let privada = "";
let ajena = "";

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants restart identity cascade`);
  });
}

type Fila = Record<string, unknown>;
const q = async (consulta: ReturnType<typeof sql>) => (await getDb().execute(consulta)) as unknown as Fila[];

async function contacto(id: string, opts: { lista: string | null; plazo: number | null; cuenta?: string }) {
  await getDb().execute(sql`
    insert into public.alegra_contacts (tenant_id, alegra_account, alegra_id, name, types, price_list_id, payment_term_days, status)
    values (${TENANT}, ${opts.cuenta ?? "principal"}, ${id}, ${"Cliente " + id}, ${"{client}"}::text[], ${opts.lista}, ${opts.plazo}, 'active')
  `);
}

beforeAll(async () => {
  await limpiar();
  const db = getDb();
  for (const t of [TENANT, OTRO_TENANT]) {
    await db.execute(
      sql`insert into public.tenants (id, name, logo_path, resend_from) values (${t}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
    );
  }
  const [p] = await q(sql`insert into public.listas_precio_online (tenant_id, nombre, coeficiente, privada) values (${TENANT}, 'Lista privada A', 1.2, true) returning id`);
  const [a] = await q(sql`insert into public.listas_precio_online (tenant_id, nombre, coeficiente, privada) values (${OTRO_TENANT}, 'Lista ajena', 1.2, true) returning id`);
  privada = String(p.id);
  ajena = String(a.id);
  await db.execute(sql`
    insert into public.lista_precio_alegra_mapeo (tenant_id, alegra_account, alegra_price_list_id, lista_id)
    values (${TENANT}, 'principal', '7', ${privada}), (${OTRO_TENANT}, 'principal', '8', ${ajena})
  `);
  const privados = JSON.stringify([{ idPriceList: privada, name: "Lista privada A", price: 120 }]);
  const privadosCero = JSON.stringify([{ idPriceList: privada, name: "Lista privada A", price: 0 }]);
  const privadosAjenos = JSON.stringify([{ idPriceList: ajena, name: "Lista ajena", price: 5 }]);
  await db.execute(sql`
    insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, precios_online_privados)
    values (${TENANT}, '1', 'Con precio', 10, 'active', 'active', ${privados}::jsonb),
           (${TENANT}, '2', 'Sin renglón', 10, 'active', 'active', '[]'::jsonb),
           (${TENANT}, '3', 'Precio cero', 10, 'active', 'active', ${privadosCero}::jsonb),
           (${OTRO_TENANT}, '1', 'Ajeno', 10, 'active', 'active', ${privadosAjenos}::jsonb)
  `);
  await contacto("1001", { lista: "7", plazo: 30 }); // CC con lista enlazada
  await contacto("1002", { lista: null, plazo: 30 }); // CC sin lista
  await contacto("1003", { lista: "99", plazo: 30 }); // CC con lista sin enlace
  await contacto("1004", { lista: "7", plazo: 0 }); // contado con lista enlazada
  await contacto("1005", { lista: "7", plazo: 30, cuenta: "mdp" }); // otra cuenta de Alegra: no se lee
});

afterAll(async () => {
  await limpiar();
});

describe("listaMapeada", () => {
  it("clave (tenant, cuenta, lista de Alegra)", async () => {
    expect(await listaMapeada("principal", "7")).toBe(privada);
    expect(await listaMapeada("principal", "99")).toBeNull();
    expect(await listaMapeada("mdp", "7")).toBeNull();
  });

  it("no ve el enlace de otro tenant", async () => {
    expect(await listaMapeada("principal", "8")).toBeNull();
  });
});

describe("listaPrivadaDeContacto", () => {
  it("cuenta corriente con lista enlazada: la lista privada", async () => {
    expect(await listaPrivadaDeContacto("1001")).toBe(privada);
  });

  it("cuenta corriente sin lista o sin enlace: precio público", async () => {
    expect(await listaPrivadaDeContacto("1002")).toBeNull();
    expect(await listaPrivadaDeContacto("1003")).toBeNull();
  });

  it("contado: precio público aunque su lista esté enlazada", async () => {
    expect(await listaPrivadaDeContacto("1004")).toBeNull();
  });

  it("contacto desconocido o de otra cuenta de Alegra: precio público", async () => {
    expect(await listaPrivadaDeContacto("9999")).toBeNull();
    expect(await listaPrivadaDeContacto("1005")).toBeNull();
  });
});

describe("preciosPrivados", () => {
  it("precio neto por id; sin renglón o en 0 es null (Consulte), nunca 0", async () => {
    const m = await preciosPrivados(privada, ["1", "2", "3"]);
    expect(m.get("1")).toBe(120);
    expect(m.get("2")).toBeNull();
    expect(m.get("3")).toBeNull();
  });

  it("una lista de otro tenant no devuelve nada aunque se conozca su id", async () => {
    const m = await preciosPrivados(ajena, ["1"]);
    expect(m.get("1")).toBeNull();
  });

  it("sin ids no consulta", async () => {
    expect((await preciosPrivados(privada, [])).size).toBe(0);
  });
});

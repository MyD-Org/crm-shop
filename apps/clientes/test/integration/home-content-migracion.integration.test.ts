import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assertLocalTestDb } from "./db-url";

/**
 * Migración 0037 (home_content con tenant, fase expand) contra Postgres REAL (local).
 * Se re-aplica el .sql a mano sobre una base ya migrada por el globalSetup: es idempotente, y se
 * reconstruye el estado "previo" (sin tenant_id NOT NULL / default) para ver el backfill.
 * Datos inventados.
 */

const MIGRACION = readFileSync(
  fileURLToPath(new URL("../../drizzle/0037_home_content_tenant.sql", import.meta.url)),
  "utf8",
);
const SENTENCIAS = MIGRACION.split("--> statement-breakpoint").map((s) => s.trim());

type Fila = Record<string, unknown>;
const q = async (c: ReturnType<typeof sql>) => (await getDb().execute(c)) as unknown as Fila[];

async function aplicar0037() {
  for (const s of SENTENCIAS) await getDb().execute(sql.raw(s));
}

/** Deja home_content como antes de la 0037: tenant_id nullable y sin default. */
async function estadoPrevio() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  const db = getDb();
  await db.execute(sql`truncate table shop.home_content, shop.carts, shop.clientes, shop.orders restart identity cascade`);
  // Vuelve al esquema previo a la 0038 (PK(key), sin índice (tenant_id, key)); el globalSetup ya migró todo.
  await db.execute(sql`alter table shop.home_content drop constraint if exists home_content_pkey`);
  await db.execute(sql`drop index if exists shop.home_content_tenant_key`);
  await db.execute(sql`alter table shop.home_content add primary key (key)`);
  await db.execute(sql`alter table shop.home_content alter column tenant_id drop not null`);
  await db.execute(sql`alter table shop.home_content alter column tenant_id drop default`);
}

async function defaultDeTenant(): Promise<string | null> {
  const [f] = await q(sql`
    select column_default as d from information_schema.columns
    where table_schema = 'shop' and table_name = 'home_content' and column_name = 'tenant_id'`);
  return (f?.d as string | null) ?? null;
}

async function esNotNull(): Promise<boolean> {
  const [f] = await q(sql`
    select is_nullable as n from information_schema.columns
    where table_schema = 'shop' and table_name = 'home_content' and column_name = 'tenant_id'`);
  return f.n === "NO";
}

const carrito = (tenant: string) =>
  getDb().execute(sql`insert into shop.carts (tenant_id, clerk_user_id) values (${tenant}, 'user_x')`);

beforeEach(estadoPrevio);

afterAll(async () => {
  // Estado final = el de una base migrada hasta la 0038 (PK compuesta, NOT NULL, sin default).
  await estadoPrevio();
  await aplicar0037();
  const m38 = readFileSync(
    fileURLToPath(new URL("../../drizzle/0038_home_content_pk_tenant.sql", import.meta.url)),
    "utf8",
  );
  for (const s of m38.split("--> statement-breakpoint").map((x) => x.trim())) await getDb().execute(sql.raw(s));
});

describe("migración 0037 home_content_tenant", () => {
  it("backfill: con UN tenant en la base completa las filas, deja default y NOT NULL", async () => {
    await carrito("tenant-base");
    await getDb().execute(sql`
      insert into shop.home_content (key, payload) values ('hero', '{"a":1}'::jsonb), ('footer', '{"b":2}'::jsonb)`);
    await aplicar0037();

    const filas = await q(sql`select key, tenant_id from shop.home_content order by key`);
    expect(filas).toEqual([
      { key: "footer", tenant_id: "tenant-base" },
      { key: "hero", tenant_id: "tenant-base" },
    ]);
    expect(await esNotNull()).toBe(true);
    expect(await defaultDeTenant()).toContain("tenant-base");
    // El código viejo (insert sin tenant_id) sigue andando y cae en el tenant base.
    await getDb().execute(sql`insert into shop.home_content (key, payload) values ('legal', '{}'::jsonb)`);
    const [l] = await q(sql`select tenant_id from shop.home_content where key = 'legal'`);
    expect(l.tenant_id).toBe("tenant-base");
  });

  it("es idempotente: aplicarla dos veces no falla ni cambia los datos", async () => {
    await carrito("tenant-base");
    await getDb().execute(sql`insert into shop.home_content (key, payload) values ('hero', '{}'::jsonb)`);
    await aplicar0037();
    await aplicar0037();
    const filas = await q(sql`select key, tenant_id from shop.home_content`);
    expect(filas).toEqual([{ key: "hero", tenant_id: "tenant-base" }]);
    expect(await esNotNull()).toBe(true);
    const idx = await q(sql`select 1 from pg_indexes where schemaname = 'shop' and indexname = 'home_content_tenant_key'`);
    expect(idx).toHaveLength(1);
  });

  it("base vacía (0 tenants) y tabla vacía: sólo NOT NULL, sin default", async () => {
    await aplicar0037();
    expect(await esNotNull()).toBe(true);
    expect(await defaultDeTenant()).toBeNull();
  });

  it("más de un tenant con filas sin tenant: falla y no deja nada a medias", async () => {
    await carrito("tenant-a");
    await carrito("tenant-b");
    await getDb().execute(sql`insert into shop.home_content (key, payload) values ('hero', '{}'::jsonb)`);
    await expect(aplicar0037()).rejects.toThrow();
    expect(await esNotNull()).toBe(false);
  });

  it("0 tenants pero con filas sin tenant: falla (no inventa uno)", async () => {
    await getDb().execute(sql`insert into shop.home_content (key, payload) values ('hero', '{}'::jsonb)`);
    await expect(aplicar0037()).rejects.toThrow();
  });

  it("más de un tenant con la tabla ya completa: sólo NOT NULL, sin default", async () => {
    await carrito("tenant-a");
    await carrito("tenant-b");
    await getDb().execute(sql`insert into shop.home_content (key, tenant_id, payload) values ('hero', 'tenant-a', '{}'::jsonb)`);
    await aplicar0037();
    expect(await esNotNull()).toBe(true);
    expect(await defaultDeTenant()).toBeNull();
  });

  it("índice único (tenant_id, key): misma key en dos tenants convive; repetida en uno no", async () => {
    await aplicar0037();
    const db = getDb();
    await db.execute(sql`insert into shop.home_content (key, tenant_id, payload) values ('hero', 'tenant-a', '{}'::jsonb)`);
    // La PK(key) sigue vigente en la fase expand: dos tenants con la misma key recién conviven tras la 0038.
    await expect(
      db.execute(sql`insert into shop.home_content (key, tenant_id, payload) values ('hero', 'tenant-a', '{}'::jsonb)`),
    ).rejects.toThrow();
  });
});

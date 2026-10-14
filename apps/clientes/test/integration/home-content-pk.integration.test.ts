import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assertLocalTestDb } from "./db-url";

/**
 * Migración 0038 (PK compuesta de home_content, fase contract) contra Postgres REAL (local).
 * Parte del estado de la 0037 (PK(key), índice único (tenant_id, key), DEFAULT dinámico) y re-aplica el .sql.
 * Datos inventados.
 */

const leer = (n: string) =>
  readFileSync(fileURLToPath(new URL(`../../drizzle/${n}.sql`, import.meta.url)), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim());
const M37 = leer("0037_home_content_tenant");
const M38 = leer("0038_home_content_pk_tenant");

type Fila = Record<string, unknown>;
const q = async (c: ReturnType<typeof sql>) => (await getDb().execute(c)) as unknown as Fila[];
const correr = async (ss: string[]) => {
  for (const s of ss) await getDb().execute(sql.raw(s));
};

/** Deja home_content como tras la 0037: PK(key) + índice único (tenant_id, key). */
async function estado0037() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  const db = getDb();
  await db.execute(sql`truncate table shop.home_content, shop.carts, shop.clientes, shop.orders restart identity cascade`);
  await db.execute(sql`alter table shop.home_content drop constraint if exists home_content_pkey`);
  await db.execute(sql`drop index if exists shop.home_content_tenant_key`);
  await db.execute(sql`alter table shop.home_content add primary key (key)`);
  await db.execute(sql`alter table shop.home_content alter column tenant_id drop not null`);
  await db.execute(sql`alter table shop.home_content alter column tenant_id drop default`);
  await correr(M37);
}

const pk = async () =>
  (await q(sql`
    select a.attname as col from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'shop.home_content'::regclass and i.indisprimary
    order by a.attname`)).map((f) => f.col);
const defaultDeTenant = async () =>
  ((await q(sql`
    select column_default as d from information_schema.columns
    where table_schema = 'shop' and table_name = 'home_content' and column_name = 'tenant_id'`))[0]?.d as string | null) ?? null;

beforeEach(estado0037);
afterAll(async () => {
  await estado0037();
  await correr(M38);
});

describe("migración 0038 home_content_pk_tenant", () => {
  it("la PK pasa a (tenant_id, key), quita el DEFAULT y conserva los datos", async () => {
    await getDb().execute(sql`insert into shop.carts (tenant_id, clerk_user_id) values ('tenant-base', 'user_x')`);
    await correr(M37); // 1 tenant -> deja DEFAULT
    await getDb().execute(sql`insert into shop.home_content (key, payload) values ('hero', '{"a":1}'::jsonb)`);
    expect(await defaultDeTenant()).toContain("tenant-base");
    await correr(M38);
    expect(await pk()).toEqual(["key", "tenant_id"]);
    expect(await defaultDeTenant()).toBeNull();
    expect(await q(sql`select key, tenant_id from shop.home_content`)).toEqual([{ key: "hero", tenant_id: "tenant-base" }]);
    const idx = await q(sql`select indexname from pg_indexes where schemaname = 'shop' and tablename = 'home_content'`);
    expect(idx.map((i) => i.indexname)).toEqual(["home_content_pkey"]);
  });

  it("es idempotente: aplicarla dos veces no falla", async () => {
    await correr(M38);
    await correr(M38);
    expect(await pk()).toEqual(["key", "tenant_id"]);
    expect(await defaultDeTenant()).toBeNull();
  });

  it("dos tenants con la misma key conviven (incluida pagina:garantia); repetida en uno no", async () => {
    await correr(M38);
    const db = getDb();
    for (const k of ["hero", "pagina:garantia"])
      for (const t of ["tenant-a", "tenant-b"])
        await db.execute(sql`insert into shop.home_content (key, tenant_id, payload) values (${k}, ${t}, '{}'::jsonb)`);
    await expect(
      db.execute(sql`insert into shop.home_content (key, tenant_id, payload) values ('hero', 'tenant-a', '{}'::jsonb)`),
    ).rejects.toThrow();
  });

  it("insertar sin tenant_id falla (ya no hay DEFAULT)", async () => {
    await correr(M38);
    await expect(
      getDb().execute(sql`insert into shop.home_content (key, payload) values ('hero', '{}'::jsonb)`),
    ).rejects.toThrow();
  });

  it("con filas sin tenant (columna nullable) falla con mensaje claro y no cambia la PK", async () => {
    const db = getDb();
    await db.execute(sql`alter table shop.home_content alter column tenant_id drop not null`);
    await db.execute(sql`insert into shop.home_content (key, payload) values ('hero', '{}'::jsonb)`);
    await expect(correr(M38)).rejects.toThrow(/sin tenant/);
    expect(await pk()).toEqual(["key"]);
  });
});

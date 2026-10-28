import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getFacetas, getPaginaCatalogo, type FiltrosCatalogo } from "@/lib/catalog";
import { assertLocalTestDb } from "./db-url";

/**
 * Orden, filtro y rango de precio con campañas de precios (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md) contra Postgres REAL local: durante una campaña el
 * catálogo ordena y filtra por el precio que muestra la card (el de campaña), no por el normal.
 * Datos inventados.
 *
 * OPT-IN, como orden-destacados (la `shop_test` compartida puede estar desfasada de las migraciones):
 *
 *   CAMPANIAS_SQL=1 TEST_DATABASE_URL=postgres://localhost:5432/shop_test_campanias npm run test:integration -- orden-precio-campania
 */

const TENANT = process.env.SHOP_TENANT_ID!; // lo fija vitest.config.mts (proyecto integration)
const CAMPANIA = "00000000-0000-4000-8000-0000000000c1";
const LISTA = "00000000-0000-4000-8000-0000000000a1";

/** id → precio neto normal; el de 150 está en campaña al 50 % (75). IVA 21 %. */
const PRODUCTOS: Record<string, number> = { cien: 100, cientoCincuenta: 150, doscientos: 200 };

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants restart identity cascade`);
  });
}

async function sembrar() {
  const db = getDb();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  for (const [id, precio] of Object.entries(PRODUCTOS)) {
    const campania =
      id === "cientoCincuenta"
        ? [{ id: CAMPANIA, reglaId: CAMPANIA, inicio: "2026-11-27T03:00:00Z", fin: "2026-12-01T03:00:00Z", pct: 50, unidades: null, precios: [{ idPriceList: LISTA, price: precio / 2 }] }]
        : null;
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online, campanias_online)
          values (${TENANT}, ${id}, ${`Lampara ${id}`}, 10, 'active', 'active', 21,
                  ${JSON.stringify([{ idPriceList: LISTA, name: "Tarjeta", price: precio, main: true }])}::jsonb,
                  ${campania ? JSON.stringify(campania) : null}::jsonb)`,
    );
  }
}

const ids = async (orden: "precio-asc" | "precio-desc", filtros: FiltrosCatalogo = {}) =>
  (await getPaginaCatalogo({ soloVisibles: false, orden, filtros })).productos.map((p) => p.id);

const conCampania: FiltrosCatalogo = { precioCampanias: [CAMPANIA] };

describe.skipIf(process.env.CAMPANIAS_SQL !== "1")("precio de campaña en orden, filtro y rango (Postgres)", () => {
  beforeAll(async () => {
    await limpiar();
    await sembrar();
  });
  afterAll(async () => {
    await limpiar();
    await getDb().$client.end({ timeout: 5 });
  });

  it("con la campaña activa ordena por el precio de campaña", async () => {
    expect(await ids("precio-asc", conCampania)).toEqual(["cientoCincuenta", "cien", "doscientos"]);
    expect(await ids("precio-desc", conCampania)).toEqual(["doscientos", "cien", "cientoCincuenta"]);
  });

  it("sin campañas activas, el orden de siempre", async () => {
    expect(await ids("precio-asc")).toEqual(["cien", "cientoCincuenta", "doscientos"]);
  });

  it("el filtro \"hasta $95\" (con IVA) incluye sólo el de campaña (90,75); el normal más barato es 121", async () => {
    expect(await ids("precio-asc", { ...conCampania, precioMax: 95 })).toEqual(["cientoCincuenta"]);
    expect(await ids("precio-asc", { precioMax: 95 })).toEqual([]);
  });

  it("el rango del slider arranca en el mínimo de campaña", async () => {
    const f = await getFacetas(conCampania, false);
    expect(f.precio).toEqual({ min: 90, max: 242 });
    const sin = await getFacetas({}, false);
    expect(sin.precio).toEqual({ min: 121, max: 242 });
  });
});

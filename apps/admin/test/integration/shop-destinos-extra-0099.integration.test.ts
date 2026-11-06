import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { leerFilaShop } from "@/lib/shop-destino-db"
import { resolverDestinosShop } from "@/lib/shop-destino"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0099 (change `dominios-clerk-por-host`): `tenants.shop_destinos_extra`.
 * `leerFilaShop` lee en tres niveles y NUNCA tira:
 *   1. las tres columnas;  2. si falla, las dos clásicas + extras [] (columna aún sin migrar);
 *   3. si también falla, la fila vacía (comportamiento de siempre).
 * Datos inventados, dominios `.example`.
 */

const TENANT = "tenant-extra"
const EXTRAS = [{ etiqueta: "tienda-b", url: "https://tienda-b.example", urlInterna: "https://interno-b.example" }]

async function fijarFila(shopUrl: string, extras: unknown) {
  await getDb().execute(
    sql`update tenants set shop_url = ${shopUrl}, shop_internal_url = '', shop_destinos_extra = ${JSON.stringify(extras)}::jsonb where id = ${TENANT}`,
  )
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe("tenants.shop_destinos_extra", () => {
  it("la columna nace como lista vacía (default) y solo admite arrays (CHECK)", async () => {
    const [fila] = await getDb().execute<{ extras: unknown }>(sql`select shop_destinos_extra as extras from tenants where id = ${TENANT}`)
    expect(fila.extras).toEqual([])
    await expect(
      getDb().execute(sql`update tenants set shop_destinos_extra = '{"no":"array"}'::jsonb where id = ${TENANT}`),
    ).rejects.toThrow()
  })
})

describe("leerFilaShop", () => {
  it("nivel 1: devuelve las tres columnas y el resolver arma principal + extra", async () => {
    await fijarFila("https://a.example", EXTRAS)
    const fila = await leerFilaShop(TENANT)
    expect(fila.shopUrl).toBe("https://a.example")
    expect(fila.shopDestinosExtra).toEqual(EXTRAS)

    const { destinos, omitidos } = resolverDestinosShop(TENANT, fila, {
      SHOP_CRM_SECRET_TENANT_EXTRA: "sa",
      SHOP_CRM_SECRET_TENANT_EXTRA__TIENDA_B: "sb",
    })
    expect(destinos.map((d) => d.etiqueta)).toEqual(["principal", "tienda-b"])
    expect(omitidos).toEqual([])
  })

  it("sin extras: lista vacía y el resolver da solo el principal", async () => {
    await fijarFila("https://a.example", [])
    const fila = await leerFilaShop(TENANT)
    expect(fila.shopDestinosExtra).toEqual([])
    expect(resolverDestinosShop(TENANT, fila, { SHOP_CRM_SECRET_TENANT_EXTRA: "sa" }).destinos).toHaveLength(1)
  })

  it("un tenant inexistente da la fila vacía, sin tirar", async () => {
    await expect(leerFilaShop("no-existe")).resolves.toEqual({ shopUrl: "", shopInternalUrl: "" })
  })

  it("jsonb con ítems inválidos: el resolver conserva el principal y descarta lo roto", async () => {
    await fijarFila("https://a.example", [{ etiqueta: "roto", url: "" }, 42, ...EXTRAS])
    const fila = await leerFilaShop(TENANT)
    const { destinos, omitidos } = resolverDestinosShop(TENANT, fila, {
      SHOP_CRM_SECRET_TENANT_EXTRA: "sa",
      SHOP_CRM_SECRET_TENANT_EXTRA__TIENDA_B: "sb",
    })
    expect(destinos.map((d) => d.etiqueta)).toEqual(["principal", "tienda-b"])
    expect(omitidos).toEqual(["roto", "#1"])
  })

  it("nivel 2: columna ausente → las dos clásicas, extras [] y un warn (no cae al par histórico)", async () => {
    await fijarFila("https://a.example", EXTRAS)
    await getDb().execute(sql`alter table tenants rename column shop_destinos_extra to shop_destinos_extra_tmp`)
    try {
      const fila = await leerFilaShop(TENANT)
      expect(fila).toEqual({ shopUrl: "https://a.example", shopInternalUrl: "", shopDestinosExtra: [] })
      expect(console.warn).toHaveBeenCalled()
    } finally {
      await getDb().execute(sql`alter table tenants rename column shop_destinos_extra_tmp to shop_destinos_extra`)
    }
  })

  it("nivel 3: si fallan también las clásicas → fila vacía, sin tirar", async () => {
    await getDb().execute(sql`alter table tenants rename column shop_internal_url to shop_internal_url_tmp`)
    try {
      await expect(leerFilaShop(TENANT)).resolves.toEqual({ shopUrl: "", shopInternalUrl: "" })
      expect(console.warn).toHaveBeenCalled()
    } finally {
      await getDb().execute(sql`alter table tenants rename column shop_internal_url_tmp to shop_internal_url`)
    }
  })
})

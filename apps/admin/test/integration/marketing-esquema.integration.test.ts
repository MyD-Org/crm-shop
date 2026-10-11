import { beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { marketingPiezas, marketingMarca } from "@/db/schema"
import { seedTenant, truncateAll } from "./helpers"

const T = "tenant-mkt"

describe("esquema de marketing", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(T)
  })

  it("inserta una pieza con los defaults esperados", async () => {
    const [p] = await getDb()
      .insert(marketingPiezas)
      .values({ tenantId: T, canal: "instagram", formato: "reel", plantilla: "producto-destacado", publico: "ambos", tema: "producto", objetivo: "alcance", produccion: "auto" })
      .returning()
    expect(p.estado).toBe("borrador")
    expect(p.version).toBe(1)
    expect(p.contenido).toEqual({})
    expect(p.hashtags).toEqual([])
  })

  it("rechaza un estado fuera del CHECK", async () => {
    await expect(
      getDb().execute(
        sql`insert into marketing_piezas (tenant_id, canal, formato, plantilla, publico, tema, objetivo, produccion, estado)
            values (${T}, 'instagram', 'reel', 'x', 'ambos', 'producto', 'alcance', 'auto', 'inventado')`,
      ),
    ).rejects.toThrow()
  })

  it("permite una sola marca por tenant", async () => {
    await getDb().insert(marketingMarca).values({ tenantId: T })
    await expect(getDb().insert(marketingMarca).values({ tenantId: T })).rejects.toThrow()
  })
})

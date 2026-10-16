import { describe, it, expect, beforeEach } from "vitest"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import { truncateAll, seedTenant } from "./helpers"
import { leerProductosDesde } from "@/lib/plataforma-productos-fuente"
import { leerCursorProductos } from "@/lib/plataforma-proyeccion-repo"

const T = "central-led"
const t1 = new Date("2026-10-15T00:00:01Z"), t2 = new Date("2026-10-15T00:00:02Z"), t3 = new Date("2026-10-15T00:00:03Z")
const ids = (f: { alegraId: string }[]) => f.map((x) => x.alegraId)

describe("fuente de productos para la plataforma", () => {
  beforeEach(async () => {
    await truncateAll(); await seedTenant(T)
    // Empates a propósito: la sync estampa un synced_at por lote.
    await getDb().insert(catalogProducts).values([
      { tenantId: T, alegraId: "5", name: "E", syncedAt: t3 },
      { tenantId: T, alegraId: "3", name: "C", syncedAt: t2 },
      { tenantId: T, alegraId: "1", name: "A", syncedAt: t1 },
      { tenantId: T, alegraId: "4", name: "D", syncedAt: t2 },
      { tenantId: T, alegraId: "2", name: "B", syncedAt: t2 },
    ])
  })

  it("desde el cursor inicial devuelve todo en orden (synced_at, alegra_id)", async () => {
    expect(ids(await leerProductosDesde(T, await leerCursorProductos(T), 500))).toEqual(["1", "2", "3", "4", "5"])
  })

  it("el cursor compuesto parte un empate: desde {t2,'2'} devuelve 3, 4 y 5", async () => {
    expect(ids(await leerProductosDesde(T, { at: t2, clave: "2" }, 500))).toEqual(["3", "4", "5"])
  })

  it("con lote=2 se pagina sin perder ni repetir filas empatadas", async () => {
    expect(ids(await leerProductosDesde(T, { at: new Date(0), clave: "" }, 2))).toEqual(["1", "2"])
    expect(ids(await leerProductosDesde(T, { at: t2, clave: "2" }, 2))).toEqual(["3", "4"])
  })

  it("no mezcla productos de otros tenants", async () => {
    await seedTenant("otro")
    await getDb().insert(catalogProducts).values({ tenantId: "otro", alegraId: "9", name: "X", syncedAt: t3 })
    expect(ids(await leerProductosDesde(T, { at: t3, clave: "5" }, 500))).toEqual([])
  })
})

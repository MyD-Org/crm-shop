import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { AlegraProduct } from "@/lib/alegra"
import { seedTenant, truncateAll } from "./helpers"

// Lectura en vivo del catálogo (change `sucursales-igz-mdp`, D.1.21): un id sintético de una fila
// solo-secundaria NUNCA llega a Alegra; se resuelve el id real y las credenciales de SU cuenta.
// Datos inventados: tenant-a, cuentas principal y `mdp`.

const llamadas: { token: string; ids: string[] }[] = []
const vivo = (id: string, nombre: string, lista = "general"): AlegraProduct => ({
  alegraId: id,
  code: "X",
  name: nombre,
  description: null,
  categoryAlegraId: null,
  prices: [{ idPriceList: "9", name: lista, price: 500 }],
  stock: 3,
  status: "active",
  images: [],
  brand: null,
  ivaPorcentaje: 21,
  raw: {},
})

vi.mock("@/lib/alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alegra")>()),
  getItemsLive: async (cfg: { alegraToken: string }, ids: string[]) => {
    llamadas.push({ token: cfg.alegraToken, ids })
    return ids.map((id) => vivo(id, `Vivo ${cfg.alegraToken} ${id}`))
  },
}))

const { getItemsLiveDelCatalogo } = await import("@/lib/alegra-live-catalogo")
const A = "tenant-a"
const cfg = { id: A, alegraEmail: "igz@cliente.example", alegraToken: "tok-igz", alegraMock: false } as Parameters<typeof getItemsLiveDelCatalogo>[0]

beforeEach(async () => {
  llamadas.length = 0
  await truncateAll()
  await getDb().execute(sql`truncate table catalog_products, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await getDb().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await getDb().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'mdp@cliente.example', 'tok-mdp')`)
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, prices, cuenta_id, alegra_id_cuenta)
    VALUES (${A}, '1', 'De IGZ', '[{"idPriceList":"1","name":"General","price":100}]'::jsonb, NULL, NULL)
  `)
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, prices, cuenta_id, alegra_id_cuenta)
    SELECT ${A}, 'mdp:77', 'Solo MDP', '[{"idPriceList":"1","name":"General","price":100}]'::jsonb, id, '77' FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'
  `)
})
afterAll(async () => {
  await truncateAll()
})

describe("getItemsLiveDelCatalogo", () => {
  it("una fila solo-MDP se pide a la cuenta de MDP con el id REAL, y vuelve con el id del catálogo y las listas de la principal", async () => {
    const r = await getItemsLiveDelCatalogo(cfg, ["1", "mdp:77"])
    expect(llamadas).toEqual([
      { token: "tok-igz", ids: ["1"] },
      { token: "tok-mdp", ids: ["77"] },
    ])
    expect(llamadas.some((l) => l.ids.includes("mdp:77"))).toBe(false)
    expect(r.map((x) => x.alegraId).sort()).toEqual(["1", "mdp:77"])
    const mdp = r.find((x) => x.alegraId === "mdp:77")!
    expect(mdp.prices).toEqual([{ idPriceList: "1", name: "General", price: 500 }])
  })

  it("una cuenta sin credenciales no llama a Alegra con las de otra: el ítem no vuelve", async () => {
    await getDb().execute(sql`UPDATE alegra_cuentas SET alegra_token = '' WHERE tenant_id = ${A} AND slug = 'mdp'`)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await getItemsLiveDelCatalogo(cfg, ["mdp:77"])
    expect(llamadas).toEqual([])
    expect(r).toEqual([])
  })

  it("un id que no está en el espejo se comporta como hoy (va a la principal)", async () => {
    const r = await getItemsLiveDelCatalogo(cfg, ["999"])
    expect(llamadas).toEqual([{ token: "tok-igz", ids: ["999"] }])
    expect(r).toHaveLength(1)
  })
})

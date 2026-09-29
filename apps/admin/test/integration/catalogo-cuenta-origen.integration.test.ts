import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { listarProductos } from "@/lib/catalogo-overlay-repo"
import { parsearQueryListado } from "@/lib/catalogo-admin"
import { revisionDeCatalogo } from "@/lib/catalogo-revision"
import { crearSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Listado del catálogo con cuenta de origen y solapa "Revisión" (change `sucursales-igz-mdp`,
// rebanada D, lote 2). Datos inventados: tenant-a / tenant-b, cuentas principal y `mdp`.

const A = "tenant-a"
const B = "tenant-b"
const PRECIO = '[{"idPriceList":"1","name":"General","price":100}]'

const db = () => getDb()
const ids = async (filtros: Parameters<typeof listarProductos>[1]) =>
  (await listarProductos(A, filtros, { limit: 200 })).items.map((i) => i.alegraId).sort()

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products, catalog_sync_log, catalog_overlay, alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await seedTenant(B)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true), (${B}, 'principal', 'Otra', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre) VALUES (${A}, 'mdp', 'Mar del Plata')`)
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await db().execute(sql`UPDATE sucursales SET cuenta_alegra_id = (SELECT id FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp') WHERE tenant_id = ${A} AND slug = 'mdp'`)
  // Principal: 1 (normal), 2 (absorbida: reemplazada). Solo-MDP: mdp:7 (activa), mdp:8 (adoptada, inactiva por stock 0).
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, stock) VALUES (${A}, '1', 'AAA', 'De la principal', ${PRECIO}::jsonb, 5)
  `)
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, status, reemplazado_por_alegra_id) VALUES (${A}, 'mdp:2', 'CCC', 'Absorbida', ${PRECIO}::jsonb, 'inactive', '1')
  `)
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, stock, cuenta_id, alegra_id_cuenta)
    SELECT ${A}, 'mdp:7', 'ZZZ', 'Solo de MDP', ${PRECIO}::jsonb, 4, id, '7' FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'
  `)
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, stock, status, cuenta_id, alegra_id_cuenta)
    SELECT ${A}, 'mdp:8', 'YYY', 'Adoptada', ${PRECIO}::jsonb, 0, 'inactive', id, '8' FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'
  `)
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, status, alegra_status) VALUES (${A}, '9', 'YYY', 'Inactiva en la principal', ${PRECIO}::jsonb, 'active', 'inactive')
  `)
  await db().execute(sql`INSERT INTO catalog_products (tenant_id, alegra_id, name, prices) VALUES (${B}, '1', 'De otro tenant', ${PRECIO}::jsonb)`)
})

afterAll(async () => {
  await truncateAll()
})

describe("listado del catálogo: cuenta de origen", () => {
  it("sin filtro lista todo salvo la fila absorbida (reemplazada)", async () => {
    expect(await ids({})).toEqual(["1", "9", "mdp:7", "mdp:8"])
  })

  it("cuenta=principal: solo cuenta_id NULL; cuenta=mdp: solo las de MDP", async () => {
    expect(await ids({ cuenta: "principal" })).toEqual(["1", "9"])
    expect(await ids({ cuenta: "mdp" })).toEqual(["mdp:7", "mdp:8"])
  })

  it("una cuenta inexistente no devuelve nada (y no rompe)", async () => {
    expect(await ids({ cuenta: "zzz" })).toEqual([])
  })

  it("la fila de MDP trae la cuenta y la sucursal para el badge 'Solo en …'; la principal, null", async () => {
    const { items } = await listarProductos(A, {}, { limit: 200 })
    expect(items.find((i) => i.alegraId === "mdp:7")?.cuenta).toEqual({ slug: "mdp", nombre: "Mar del Plata", sucursal: "Mar del Plata" })
    expect(items.find((i) => i.alegraId === "1")?.cuenta).toBeNull()
  })

  it("aísla por tenant: tenant-b no ve las de A", async () => {
    const b = await listarProductos(B, {}, { limit: 200 })
    expect(b.items.map((i) => i.alegraId)).toEqual(["1"])
    expect((await listarProductos(B, { cuenta: "mdp" }, { limit: 200 })).items).toEqual([])
  })

  it("la query valida el parámetro cuenta", () => {
    const ok = parsearQueryListado(new URL("http://x/?cuenta=mdp"))
    expect(ok instanceof Response ? null : ok.filtros.cuenta).toBe("mdp")
    const principal = parsearQueryListado(new URL("http://x/?cuenta=principal"))
    expect(principal instanceof Response ? null : principal.filtros.cuenta).toBe("principal")
    expect(parsearQueryListado(new URL("http://x/?cuenta=Mal%20Slug")) instanceof Response).toBe(true)
  })
})

describe("revisión de cuentas secundarias", () => {
  it("lista los solo-MDP como informativos (marca la adoptada) y toma los códigos a revisar del último resumen", async () => {
    await db().execute(sql`
      INSERT INTO catalog_sync_log (tenant_id, trigger, status, cuenta_id, resumen, finished_at)
      SELECT ${A}, 'cron', 'ok', id,
             ${JSON.stringify({ v: 1, cuenta: "mdp", items: 3, pareados: 0, soloSecundaria: 2, adoptados: 1, sinCodigoPrincipal: 0, duplicados: { total: 1, items: [{ codigo: "DUP", principal: [], secundaria: [{ alegraId: "1", codigo: "DUP", nombre: "Uno" }, { alegraId: "2", codigo: "dup", nombre: "Dos" }] }] }, sinCodigo: { total: 0, items: [] }, listasSinEquivalente: [], sinPrecio: 0, categoriasSinEquivalente: 0 })}::jsonb,
             now()
      FROM alegra_cuentas WHERE tenant_id = ${A} AND slug = 'mdp'
    `)
    const r = await revisionDeCatalogo(A)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ slug: "mdp", nombre: "Mar del Plata", sucursal: "Mar del Plata", ultimaSync: { estado: "ok" } })
    expect(r[0].resumen?.duplicados.total).toBe(1)
    expect(r[0].soloEnCuenta.total).toBe(2)
    const porId = Object.fromEntries(r[0].soloEnCuenta.items.map((i) => [i.alegraId, i]))
    expect(porId["mdp:7"]).toMatchObject({ activo: true, adoptado: false })
    expect(porId["mdp:8"]).toMatchObject({ activo: false, adoptado: true })
    expect(JSON.stringify(r)).not.toContain("token")
  })

  it("una cuenta que nunca se sincronizó: sin resumen; los solo-MDP igual se listan; la fila absorbida no", async () => {
    const r = await revisionDeCatalogo(A)
    expect(r[0].ultimaSync).toBeNull()
    expect(r[0].resumen).toBeNull()
    expect(r[0].soloEnCuenta.items.map((i) => i.alegraId).sort()).toEqual(["mdp:7", "mdp:8"])
  })

  it("no mezcla tenants: tenant-b no tiene cuentas secundarias", async () => {
    expect(await revisionDeCatalogo(B)).toEqual([])
  })
})

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { listaPrecioCondiciones, listasPrecioOnline, preciosOnlineCambios } from "@/db/schema"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"
import { seedTenant, truncateAll } from "./helpers"
import { seedLista, seedProducto } from "./precios-online-helpers"
import {
  PreciosOnlineError,
  aplicarCambios,
  aplicarReversion,
  listarHistorial,
  previsualizar,
  type UsuarioActor,
} from "@/lib/precios-online-repo"
import type { CambioPrecios } from "@/lib/precios-online-cambios"

/**
 * Migración 0065 (change `listas-precio-online`, rebanada C) contra Postgres real:
 *  - `lista_precio_condiciones` (unicidad, CHECK, FK RESTRICT hacia la lista y CASCADE desde el medio);
 *  - la vista `catalog_products_shop` emite los precios ONLINE y nunca los de Alegra;
 *  - lo que `shop_app` puede y no puede leer;
 *  - `setCondicion`: una condición = una lista, pasa por vista previa + historial, se revierte y
 *    avisa al Shop DESPUÉS del commit (si el aviso falla, el cambio queda).
 * Datos inventados.
 */

const pings = vi.hoisted(() => ({ sucursales: 0, catalogo: 0, falla: false }))
vi.mock("@/lib/shop-revalidar", () => ({
  pingShopRevalidarSucursales: async () => {
    pings.sucursales++
    if (pings.falla) throw new Error("ping caído")
    return { propagado: true }
  },
  pingShopRevalidarCatalogo: async () => {
    pings.catalogo++
    return { propagado: true }
  },
}))

const T = "tenant-c"
const OTRO = "tenant-otro"
const ANA: UsuarioActor = { id: "u1", name: "Ana Admin", email: "ana.admin@example.com" }
const MIGRACION = fileURLToPath(new URL("../../drizzle/0065_shop_precios_online.sql", import.meta.url))

let listaRef: string
let listaTransf: string

const set = (medioSlug: string, listaId: string | null, cuotas: number | null = null): CambioPrecios => ({
  op: "setCondicion",
  medioSlug,
  cuotas,
  listaId,
})

async function previaYAplicar(cambios: CambioPrecios[]) {
  const p = await previsualizar(T, cambios)
  return aplicarCambios(T, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella })
}
const error = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as PreciosOnlineError
  }
  throw new Error("se esperaba un error")
}
const medio = async (tenantId: string, slug: string) => {
  await getDb().execute(sql`insert into medios_pago_shop (tenant_id, slug, nombre) values (${tenantId}, ${slug}, ${slug}) on conflict do nothing`)
}
const condiciones = async () => getDb().select().from(listaPrecioCondiciones).where(eq(listaPrecioCondiciones.tenantId, T))

beforeEach(async () => {
  pings.sucursales = 0
  pings.catalogo = 0
  pings.falla = false
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
  listaRef = await seedLista(T, "Lista A", "1.2", { esReferencia: true, orden: 1 })
  listaTransf = await seedLista(T, "Lista B", "1.1", { orden: 2 })
  await medio(T, "transferencia")
  await medio(T, "efectivo")
})
afterAll(async () => {
  await truncateAll()
})

describe("lista_precio_condiciones: restricciones", () => {
  it("una condición por (medio, cuotas): pago único y cada cantidad de cuotas conviven, pero no se repiten", async () => {
    const db = getDb()
    const ins = (cuotas: number | null) =>
      db.execute(sql`insert into lista_precio_condiciones (tenant_id, lista_id, medio_slug, cuotas) values (${T}, ${listaRef}, 'transferencia', ${cuotas})`)
    await ins(null)
    await ins(3)
    await ins(6)
    await expect(ins(null)).rejects.toMatchObject({ cause: { code: "23505" } })
    await expect(ins(3)).rejects.toMatchObject({ cause: { code: "23505" } })
  })

  it("cuotas debe ser NULL o >= 2", async () => {
    await expect(
      getDb().execute(sql`insert into lista_precio_condiciones (tenant_id, lista_id, medio_slug, cuotas) values (${T}, ${listaRef}, 'transferencia', 1)`),
    ).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("no se borra una lista con condiciones (RESTRICT) y el medio borrado arrastra su condición (CASCADE)", async () => {
    await getDb().insert(listaPrecioCondiciones).values({ tenantId: T, listaId: listaTransf, medioSlug: "transferencia" })
    await expect(getDb().delete(listasPrecioOnline).where(eq(listasPrecioOnline.id, listaTransf))).rejects.toMatchObject({
      cause: { code: "23001" },
    })
    await getDb().execute(sql`delete from medios_pago_shop where tenant_id = ${T} and slug = 'transferencia'`)
    expect(await condiciones()).toHaveLength(0)
  })

  it("el medio tiene que existir en ese tenant (FK compuesta)", async () => {
    await expect(
      getDb().insert(listaPrecioCondiciones).values({ tenantId: OTRO, listaId: listaRef, medioSlug: "transferencia" }),
    ).rejects.toMatchObject({ cause: { code: "23503" } })
  })
})

describe("la vista del Shop emite los precios online", () => {
  it("precios_alegra = precios_online; los precios de Alegra no salen aunque estén en raw", async () => {
    await seedProducto(T, { alegraId: "p1", costo: "100", rawPrice: [{ idPriceList: "1", name: "Lista de Alegra", price: 999 }] })
    await getDb().execute(sql`select * from aplicar_precios_online(${T}, NULL::text[], 'config')`)
    const [v] = (await getDb().execute(
      sql`select precios_alegra from catalog_products_shop where tenant_id = ${T} and alegra_id = 'p1'`,
    )) as unknown as { precios_alegra: { idPriceList: string; name: string; price: number; main: boolean }[] }[]
    expect(v.precios_alegra.map((x) => [x.idPriceList, x.name, Number(x.price), x.main]).sort()).toEqual(
      [
        [listaRef, "Lista A", 120, true],
        [listaTransf, "Lista B", 110, false],
      ].sort(),
    )
    expect(JSON.stringify(v.precios_alegra)).not.toContain("999")
  })

  it("un producto sin costo no tiene precio online: la vista da [] (nunca $0)", async () => {
    await seedProducto(T, { alegraId: "p2", costo: null })
    await getDb().execute(sql`select * from aplicar_precios_online(${T}, NULL::text[], 'config')`)
    const [v] = (await getDb().execute(
      sql`select precios_alegra from catalog_products_shop where tenant_id = ${T} and alegra_id = 'p2'`,
    )) as unknown as { precios_alegra: unknown[] }[]
    expect(v.precios_alegra).toEqual([])
  })
})

describe("0065: lo que lee shop_app", () => {
  let cli: postgres.Sql
  let rolCreadoAca = false
  const bloque = () => {
    const partes = readFileSync(MIGRACION, "utf8").split("--> statement-breakpoint")
    return partes[partes.length - 1]
  }
  const comoShopApp = async (stmt: string): Promise<{ ok: true } | { ok: false; code: string }> => {
    let r: { ok: true } | { ok: false; code: string } = { ok: true }
    const ROLLBACK = new Error("rollback")
    try {
      await cli.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        try {
          await tx.unsafe(stmt)
        } catch (e) {
          r = { ok: false, code: (e as { code?: string }).code ?? "?" }
        }
        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
    return r
  }

  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    cli = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await cli`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await cli.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await cli.unsafe(bloque())
  })
  afterAll(async () => {
    if (rolCreadoAca) {
      await cli.unsafe("DROP OWNED BY shop_app")
      await cli.unsafe("DROP ROLE shop_app")
    }
    await cli.end()
  })

  it("lee la vista y las condiciones", async () => {
    expect(await comoShopApp("SELECT * FROM public.catalog_products_shop LIMIT 1")).toEqual({ ok: true })
    expect(await comoShopApp("SELECT tenant_id, lista_id, medio_slug, cuotas FROM public.lista_precio_condiciones")).toEqual({ ok: true })
  })

  it.each([
    "SELECT * FROM public.listas_precio_online",
    "SELECT * FROM public.lista_precio_overrides",
    "SELECT * FROM public.precios_online_config",
    "SELECT * FROM public.precios_online_cambios",
    "SELECT * FROM public.precios_online_retenciones",
    "SELECT costo FROM public.catalog_products",
    "SELECT precios_online FROM public.catalog_products",
    "UPDATE public.lista_precio_condiciones SET cuotas = 2",
    "DELETE FROM public.lista_precio_condiciones",
    "SELECT * FROM public.calcular_precios_online('x', NULL)",
  ])("sin permiso: %s", async (stmt) => {
    expect(await comoShopApp(stmt)).toEqual({ ok: false, code: "42501" })
  })

  it("el bloque de GRANTs es idempotente", async () => {
    await expect(cli.unsafe(bloque())).resolves.toBeDefined()
  })
})

describe("setCondicion: vista previa, aplicar e historial", () => {
  it("enlazar crea la condición, deja historial 'condicion' y no mueve ningún precio", async () => {
    await seedProducto(T, { alegraId: "p1", costo: "100" })
    await getDb().execute(sql`select * from aplicar_precios_online(${T}, NULL::text[], 'config')`)
    const cambios = [set("transferencia", listaTransf)]
    const previa = await previsualizar(T, cambios)
    expect(previa.productosAfectados).toBe(0)
    expect(await condiciones()).toHaveLength(0) // la previa no escribe
    await aplicarCambios(T, ANA, { cambios, baseVersion: previa.baseVersion, huella: previa.huella })
    expect(await condiciones()).toMatchObject([{ medioSlug: "transferencia", listaId: listaTransf, cuotas: null }])
    const h = await listarHistorial(T, { start: 0, limit: 10 })
    expect(h.items[0]).toMatchObject({ tipo: "condicion", usuario: "ana.admin@example.com" })
  })

  it("cambiar la lista del medio reemplaza la condición (una sola por medio y cuotas)", async () => {
    await previaYAplicar([set("transferencia", listaTransf)])
    await previaYAplicar([set("transferencia", listaRef)])
    expect(await condiciones()).toMatchObject([{ medioSlug: "transferencia", listaId: listaRef }])
  })

  it("enlazar la misma lista otra vez, quitar lo que no existe o un medio inexistente se rechazan", async () => {
    await previaYAplicar([set("transferencia", listaTransf)])
    expect((await error(previsualizar(T, [set("transferencia", listaTransf)]))).code).toBe("sin_cambios")
    expect((await error(previsualizar(T, [set("efectivo", null)]))).code).toBe("sin_cambios")
    expect((await error(previsualizar(T, [set("no-existe", listaTransf)]))).code).toBe("medio_no_existe")
  })

  it("una lista de otro tenant no se puede enlazar", async () => {
    const ajena = await seedLista(OTRO, "Lista ajena", "1.3", { esReferencia: true })
    expect((await error(previsualizar(T, [set("transferencia", ajena)]))).code).toBe("lista_no_existe")
  })

  it("desenlazar borra la condición: el medio vuelve a la referencia", async () => {
    await previaYAplicar([set("transferencia", listaTransf)])
    await previaYAplicar([set("transferencia", null)])
    expect(await condiciones()).toHaveLength(0)
  })

  it("no se borra una lista enlazada a un medio de pago (mensaje en usted)", async () => {
    await previaYAplicar([set("transferencia", listaTransf)])
    const e = await error(previsualizar(T, [{ op: "borrarLista", listaId: listaTransf }]))
    expect(e).toMatchObject({ status: 422, code: "lista_en_uso" })
    expect(e.message).toContain("enlazada a un medio de pago")
  })

  it("la condición con cuotas convive con la de pago único", async () => {
    await previaYAplicar([set("transferencia", listaTransf), set("transferencia", listaRef, 6)])
    expect((await condiciones()).map((c) => c.cuotas).sort()).toEqual([null, 6].sort())
  })

  it("revertir deja la condición como estaba", async () => {
    await previaYAplicar([set("transferencia", listaTransf)])
    await previaYAplicar([set("transferencia", listaRef)])
    const h = await listarHistorial(T, { start: 0, limit: 10 })
    const ultima = h.items[0]
    const inversos = [set("transferencia", listaTransf)]
    const previa = await previsualizar(T, inversos)
    await aplicarReversion(T, ANA, ultima.id, { baseVersion: previa.baseVersion, huella: previa.huella })
    expect(await condiciones()).toMatchObject([{ listaId: listaTransf }])
    const filas = await getDb().select().from(preciosOnlineCambios).where(eq(preciosOnlineCambios.tenantId, T))
    expect(filas.some((f) => f.tipo === "revertir" && f.revertidoDe === ultima.id)).toBe(true)
  })
})

describe("avisos al Shop tras el commit", () => {
  it("un cambio de condición avisa al catálogo y a los medios, una vez", async () => {
    await previaYAplicar([set("transferencia", listaTransf)])
    expect(pings.catalogo).toBe(1)
    expect(pings.sucursales).toBe(1)
  })

  it("un cambio que no toca condiciones no invalida los medios", async () => {
    await previaYAplicar([{ op: "editarLista", listaId: listaTransf, coeficiente: "1.2" }])
    expect(pings.catalogo).toBe(1)
    expect(pings.sucursales).toBe(0)
  })

  it("la vista previa no avisa a nadie", async () => {
    await previsualizar(T, [set("transferencia", listaTransf)])
    expect(pings.catalogo + pings.sucursales).toBe(0)
  })

  it("si el aviso falla, el cambio queda guardado y no se pierde", async () => {
    pings.falla = true
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await previaYAplicar([set("transferencia", listaTransf)])
    expect(await condiciones()).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

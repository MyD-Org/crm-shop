import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { sql as dsql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  guardarAtributosManual,
  leerAtributos,
  reemplazarAtributosDeNombre,
  sincronizarAtributosDeNombre,
  upsertAtributos,
} from "@/lib/catalogo-atributos-repo"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0049 (catálogo asistido fase 2, subproyecto 5): la tabla de atributos con la
 * precedencia manual > pdf > nombre aplicada por el upsert y los CHECK de clave/fuente. Datos
 * inventados. El tenant de estos tests no tiene la plataforma configurada (modo `off`), así que
 * escritura y lectura van a la tabla local.
 *
 * Desde el corte 0091 la tabla se llama `catalog_atributos_legacy` (conserva PK y CHECK) y
 * `catalog_atributos` es una vista sobre la proyección de la plataforma. El describe del GRANT de
 * 0049 a `shop_app` sobre la tabla se RETIRÓ: lo reemplaza `plataforma-corte.integration.test.ts`
 * (la vista con sus cinco columnas concedidas y la tabla vieja sin permisos).
 */

const A = "tenant-atr"

const mapa = async (alegraId: string) =>
  Object.fromEntries((await leerAtributos(A, alegraId)).map((a) => [a.clave, [a.valorNum ?? a.valorTexto, a.fuente]]))

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
})
afterAll(async () => {
  await truncateAll()
})

describe("catalog_atributos_legacy: precedencia", () => {
  it("nombre escribe; pdf lo pisa; nombre no pisa a pdf; manual pisa a todo; pdf no pisa a manual", async () => {
    await reemplazarAtributosDeNombre(A, [{ alegraId: "1", name: "REFLECTOR LED 50W CALIDO", description: null }])
    expect(await mapa("1")).toEqual({ potencia_w: [50, "nombre"], tono: ["calido", "nombre"] })

    await upsertAtributos(A, [{ alegraId: "1", clave: "potencia_w", valorNum: 48, valorTexto: null }], "pdf")
    await reemplazarAtributosDeNombre(A, [{ alegraId: "1", name: "REFLECTOR LED 50W CALIDO", description: null }])
    expect(await mapa("1")).toEqual({ potencia_w: [48, "pdf"], tono: ["calido", "nombre"] })

    await guardarAtributosManual(A, "1", [{ clave: "potencia_w", valorNum: 45, valorTexto: null }], [])
    expect(await upsertAtributos(A, [{ alegraId: "1", clave: "potencia_w", valorNum: 48, valorTexto: null }], "pdf")).toBe(0)
    expect(await mapa("1")).toEqual({ potencia_w: [45, "manual"], tono: ["calido", "nombre"] })
  })

  it("renombrar el producto borra las filas 'nombre' que ya no salen, no las pdf/manual", async () => {
    await reemplazarAtributosDeNombre(A, [{ alegraId: "2", name: "PANEL 12W 3000K", description: null }])
    await upsertAtributos(A, [{ alegraId: "2", clave: "flujo_lm", valorNum: 900, valorTexto: null }], "pdf")
    const r = await reemplazarAtributosDeNombre(A, [{ alegraId: "2", name: "PANEL 18W", description: null }])
    expect(r.borradas).toBe(2)
    expect(await mapa("2")).toEqual({ potencia_w: [18, "nombre"], flujo_lm: [900, "pdf"] })
  })

  it("idempotente: la segunda corrida no escribe nada", async () => {
    const p = [{ alegraId: "3", name: "DICROICA 7W 6500K GU10", description: null }]
    expect((await reemplazarAtributosDeNombre(A, p)).escritas).toBe(4)
    expect(await reemplazarAtributosDeNombre(A, p)).toEqual({ escritas: 0, borradas: 0 })
  })

  it("claves ampliadas: manual de 'polos' no lo pisa el nombre; cambiar el nombre borra las 'nombre' que ya no salen", async () => {
    await reemplazarAtributosDeNombre(A, [{ alegraId: "5", name: "TERMICA 2X25A 6KA", description: null }])
    expect(await mapa("5")).toEqual({
      corriente_a: [25, "nombre"],
      polos: [2, "nombre"],
      poder_corte_ka: [6, "nombre"],
    })

    await guardarAtributosManual(A, "5", [{ clave: "polos", valorNum: 3, valorTexto: null }], [])
    await reemplazarAtributosDeNombre(A, [{ alegraId: "5", name: "TERMICA 2X25A 6KA", description: null }])
    expect((await mapa("5")).polos).toEqual([3, "manual"])

    // El nombre cambia: las filas 'nombre' que ya no salen se borran; la manual de polos se conserva.
    await reemplazarAtributosDeNombre(A, [{ alegraId: "5", name: "TERMICA", description: null }])
    expect(await mapa("5")).toEqual({ polos: [3, "manual"] })
  })

  it("el hook de la sync no tira aunque falle la base", async () => {
    await getDb().execute(dsql`ALTER TABLE catalog_atributos_legacy RENAME TO catalog_atributos_x`)
    try {
      await expect(sincronizarAtributosDeNombre(A, [{ alegraId: "4", name: "LAMPARA 9W", description: null }], "test")).resolves.toBeUndefined()
    } finally {
      await getDb().execute(dsql`ALTER TABLE catalog_atributos_x RENAME TO catalog_atributos_legacy`)
    }
  })

  it("CHECK de clave y fuente", async () => {
    await expect(
      getDb().execute(dsql`INSERT INTO catalog_atributos_legacy (tenant_id, alegra_id, clave, valor_num, fuente) VALUES (${A}, '5', 'inventada', 1, 'nombre')`),
    ).rejects.toThrow()
    await expect(
      getDb().execute(dsql`INSERT INTO catalog_atributos_legacy (tenant_id, alegra_id, clave, valor_num, fuente) VALUES (${A}, '5', 'ip', 65, 'ia')`),
    ).rejects.toThrow()
  })
})

describe("catalog_atributos_legacy: CHECK de clave ampliado (0053, 0058, 0059, 0070, 0072, 0079)", () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../clientes/src/db/__fixtures__/atributos-claves.json", import.meta.url)), "utf8"),
  ) as { claves: string[]; tipos: Record<string, "num" | "texto"> }
  const NUEVAS = fixture.claves.slice(7)

  it("la base migrada admite exactamente las 29 claves del fixture", async () => {
    const filas = await getDb().execute<{ def: string }>(
      dsql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'catalog_atributos_clave_check' AND conrelid = 'public.catalog_atributos_legacy'::regclass`,
    )
    const claves = [...String(filas[0].def).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    expect(new Set(claves)).toEqual(new Set(fixture.claves))
    expect(claves).toHaveLength(29)
  })

  it("acepta una fila por cada una de las 22 claves nuevas", async () => {
    expect(NUEVAS).toHaveLength(22)
    for (const clave of NUEVAS) {
      const num = fixture.tipos[clave] === "num"
      await getDb().execute(
        dsql`INSERT INTO catalog_atributos_legacy (tenant_id, alegra_id, clave, valor_num, valor_texto, fuente) VALUES (${A}, '9', ${clave}, ${num ? 1 : null}, ${num ? null : "x"}, 'manual')`,
      )
    }
    expect((await leerAtributos(A, "9")).map((a) => a.clave).sort()).toEqual([...NUEVAS].sort())
  })

  it("rechaza claves fuera del vocabulario", async () => {
    for (const clave of ["material", "rgb", "espesor_mm", "peso_kg"]) {
      await expect(
        getDb().execute(dsql`INSERT INTO catalog_atributos_legacy (tenant_id, alegra_id, clave, valor_num, fuente) VALUES (${A}, '9', ${clave}, 1, 'manual')`),
      ).rejects.toThrow()
    }
  })

  it("las 7 claves previas siguen válidas", async () => {
    for (const clave of fixture.claves.slice(0, 7)) {
      const num = fixture.tipos[clave] === "num"
      await getDb().execute(
        dsql`INSERT INTO catalog_atributos_legacy (tenant_id, alegra_id, clave, valor_num, valor_texto, fuente) VALUES (${A}, '8', ${clave}, ${num ? 1 : null}, ${num ? null : "x"}, 'manual')`,
      )
    }
    expect(await leerAtributos(A, "8")).toHaveLength(7)
  })
})

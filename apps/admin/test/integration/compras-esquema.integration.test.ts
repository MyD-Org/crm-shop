import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"

/**
 * Migración 0105 (change `compras-en-transito`, S3): tablas de Compras. Verifica CHECKs, índices
 * únicos parciales, FK compuestas (un hijo no puede ser de otro tenant), cascada y que `shop_app`
 * NO tiene acceso. Datos inventados: tenants `tenant-cmp-a` / `tenant-cmp-b`.
 */

const MIGRACION = fileURLToPath(new URL("../../drizzle/0105_compras_en_transito.sql", import.meta.url))
const T_A = "tenant-cmp-a"
const T_B = "tenant-cmp-b"
const TABLAS = [
  "alegra_compras_config",
  "compras",
  "compra_items",
  "compra_percepciones",
  "compra_recepciones",
  "compra_recepcion_items",
]

let sql: postgres.Sql

async function codigoDeError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return (e as { code?: string }).code ?? "?"
  }
}

async function limpiar() {
  await sql`DELETE FROM compra_recepcion_items WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM compra_recepciones WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM compra_percepciones WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM compra_items WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM compras WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM alegra_compras_config WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM alegra_cuentas WHERE tenant_id IN (${T_A}, ${T_B})`
  await sql`DELETE FROM tenants WHERE id IN (${T_A}, ${T_B})`
}

const cuenta = async (tenant: string, slug: string) => {
  const [c] = await sql`
    INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token)
    VALUES (${tenant}, ${slug}, ${`Cuenta ${slug}`}, 'x@cliente.example', 'token-de-prueba-1234')
    RETURNING id
  `
  return c.id as string
}

let n = 0
const compra = async (tenant: string, cuentaId: string, p: Record<string, unknown> = {}) => {
  n += 1
  const v = {
    proveedor: "77",
    numero: `A-${n}`,
    estado: "pendiente",
    moneda: "ARS",
    total: 121_000,
    ...p,
  }
  const [c] = await sql`
    INSERT INTO compras (tenant_id, cuenta_id, proveedor_alegra_id, proveedor_nombre, numero_factura,
      fecha, vencimiento, moneda, almacen_id, estado, neto_centavos, iva_centavos, total_centavos, idempotency_key)
    VALUES (${tenant}, ${cuentaId}, ${v.proveedor as string}, 'Proveedor Ejemplo', ${v.numero as string},
      '2026-11-01', '2026-12-01', ${v.moneda as string}, 'alm-1', ${v.estado as string}, 100000, 21000,
      ${v.total as number}, ${`k-${tenant}-${n}`})
    RETURNING id
  `
  return c.id as string
}

const item = (tenant: string, compraId: string, orden: number, pedida = "10.000", recibida = "0") =>
  sql`
    INSERT INTO compra_items (tenant_id, compra_id, orden, alegra_id, item_id_cuenta, nombre, cantidad_pedida,
      cantidad_recibida, costo_unitario_centavos, iva_porcentaje, tax_alegra_id, neto_e5)
    VALUES (${tenant}, ${compraId}, ${orden}, 'prod-1', '694', 'Cable ejemplo', ${pedida}, ${recibida},
      10000, 21, '1', 100000000)
    RETURNING id
  `

const recepcion = (tenant: string, compraId: string, secuencia: number, key: string, estado = "pendiente") =>
  sql`
    INSERT INTO compra_recepciones (tenant_id, compra_id, secuencia, estado, idempotency_key, fecha,
      lineas_antes_hash, lineas_esperadas_hash, total_antes_centavos)
    VALUES (${tenant}, ${compraId}, ${secuencia}, ${estado}, ${key}, '2026-11-02', 'h1', 'h2', 121000)
    RETURNING id
  `

describe("migración 0105: compras en tránsito (DB real)", () => {
  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
  })

  afterAll(async () => {
    if (!sql) return
    await limpiar()
    await sql.end()
  })

  beforeEach(async () => {
    await limpiar()
    for (const id of [T_A, T_B]) {
      await sql`
        INSERT INTO tenants (id, name, logo_path, resend_from)
        VALUES (${id}, ${`Tenant ${id}`}, '/logos/test.svg', 'no-responder@plataforma.example')
      `
    }
  })

  it("es aditiva y no concede nada a shop_app", () => {
    const sqlMigracion = readFileSync(MIGRACION, "utf8")
    const instrucciones = sqlMigracion
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
    expect(instrucciones).not.toMatch(/\bGRANT\b/i)
    expect(instrucciones).not.toMatch(/\bDROP\b/i)
    expect(instrucciones).not.toMatch(/ALTER TABLE "(?!compra|alegra_compras)/)
  })

  it("shop_app no ve ninguna de las tablas nuevas", async () => {
    const roles = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (roles.length === 0) return // el rol lo crea el global-setup; sin él no hay nada que verificar
    for (const t of TABLAS) {
      const [{ ok }] = await sql`SELECT has_table_privilege('shop_app', ${`public.${t}`}, 'SELECT') AS ok`
      expect(ok, t).toBe(false)
    }
  })

  describe("compras", () => {
    it("CHECKs: moneda ARS, estado válido, total > 0", async () => {
      const c = await cuenta(T_A, "aaa")
      expect(await codigoDeError(() => compra(T_A, c, { moneda: "USD" }))).toBe("23514")
      expect(await codigoDeError(() => compra(T_A, c, { estado: "inventado" }))).toBe("23514")
      expect(await codigoDeError(() => compra(T_A, c, { total: 0 }))).toBe("23514")
      expect(await codigoDeError(() => compra(T_A, c))).toBeNull()
    })

    it("cierre_estado e importe de cierre: valores acotados", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      expect(await codigoDeError(() => sql`UPDATE compras SET cierre_estado = 'x' WHERE id = ${id}`)).toBe("23514")
      expect(await codigoDeError(() => sql`UPDATE compras SET cierre_importe_centavos = 0 WHERE id = ${id}`)).toBe("23514")
      expect(await codigoDeError(() => sql`UPDATE compras SET cierre_estado = 'manual' WHERE id = ${id}`)).toBeNull()
    })

    it("proveedor + número únicos por cuenta, salvo las anuladas", async () => {
      const c = await cuenta(T_A, "aaa")
      await compra(T_A, c, { proveedor: "9", numero: "F-1" })
      expect(await codigoDeError(() => compra(T_A, c, { proveedor: "9", numero: "F-1" }))).toBe("23505")
      // otro proveedor o otro número: ok
      expect(await codigoDeError(() => compra(T_A, c, { proveedor: "10", numero: "F-1" }))).toBeNull()
      // una anulada libera el número
      await sql`UPDATE compras SET estado = 'anulada' WHERE tenant_id = ${T_A} AND proveedor_alegra_id = '9'`
      expect(await codigoDeError(() => compra(T_A, c, { proveedor: "9", numero: "F-1" }))).toBeNull()
      // anulada_en_alegra también libera
      await sql`UPDATE compras SET estado = 'anulada_en_alegra' WHERE tenant_id = ${T_A} AND proveedor_alegra_id = '9' AND estado = 'pendiente'`
      expect(await codigoDeError(() => compra(T_A, c, { proveedor: "9", numero: "F-1" }))).toBeNull()
    })

    it("la misma factura en dos cuentas distintas es válida", async () => {
      const c1 = await cuenta(T_A, "aaa")
      const c2 = await cuenta(T_A, "bbb")
      await compra(T_A, c1, { proveedor: "9", numero: "F-1" })
      expect(await codigoDeError(() => compra(T_A, c2, { proveedor: "9", numero: "F-1" }))).toBeNull()
    })

    it("un bill de Alegra no puede estar en dos compras de la cuenta", async () => {
      const c = await cuenta(T_A, "aaa")
      const a = await compra(T_A, c)
      const b = await compra(T_A, c)
      await sql`UPDATE compras SET alegra_bill_id = '9001' WHERE id = ${a}`
      expect(await codigoDeError(() => sql`UPDATE compras SET alegra_bill_id = '9001' WHERE id = ${b}`)).toBe("23505")
    })

    it("idempotency_key única por tenant", async () => {
      const c = await cuenta(T_A, "aaa")
      const a = await compra(T_A, c)
      const [{ k }] = await sql`SELECT idempotency_key AS k FROM compras WHERE id = ${a}`
      const code = await codigoDeError(
        () => sql`
          INSERT INTO compras (tenant_id, cuenta_id, proveedor_alegra_id, proveedor_nombre, numero_factura,
            fecha, vencimiento, almacen_id, neto_centavos, iva_centavos, total_centavos, idempotency_key)
          VALUES (${T_A}, ${c}, '1', 'P', 'Z-1', '2026-11-01', '2026-12-01', 'alm-1', 1, 0, 1, ${k})`,
      )
      expect(code).toBe("23505")
    })

    it("FK compuesta a alegra_cuentas: una cuenta de otro tenant se rechaza", async () => {
      const cuentaDeB = await cuenta(T_B, "bbb")
      expect(await codigoDeError(() => compra(T_A, cuentaDeB))).toBe("23503")
    })
  })

  describe("compra_items", () => {
    it("CHECKs: cantidad pedida > 0, recibida entre 0 y la pedida", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      expect(await codigoDeError(() => item(T_A, id, 1, "0"))).toBe("23514")
      expect(await codigoDeError(() => item(T_A, id, 1, "10.000", "10.001"))).toBe("23514")
      expect(await codigoDeError(() => item(T_A, id, 1, "10.000", "-1"))).toBe("23514")
      expect(await codigoDeError(() => item(T_A, id, 1, "10.000", "10.000"))).toBeNull()
      // cantidades con 3 decimales (cable por metro)
      expect(await codigoDeError(() => item(T_A, id, 2, "1.500", "0.250"))).toBeNull()
    })

    it("orden único por compra", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      await item(T_A, id, 1)
      expect(await codigoDeError(() => item(T_A, id, 1))).toBe("23505")
    })

    it("FK compuesta: el ítem no puede declarar otro tenant que su compra", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      expect(await codigoDeError(() => item(T_B, id, 1))).toBe("23503")
    })

    it("borrar la compra borra sus ítems y percepciones (cascada)", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      await item(T_A, id, 1)
      await sql`INSERT INTO compra_percepciones (tenant_id, compra_id, alegra_perception_id, nombre, importe_centavos)
        VALUES (${T_A}, ${id}, '01a0eef5-0000-0000-0000-000000000000', 'IIBB ejemplo', 3000)`
      await sql`DELETE FROM compras WHERE id = ${id}`
      expect((await sql`SELECT 1 FROM compra_items WHERE compra_id = ${id}`).length).toBe(0)
      expect((await sql`SELECT 1 FROM compra_percepciones WHERE compra_id = ${id}`).length).toBe(0)
    })
  })

  describe("compra_percepciones", () => {
    it("importe > 0", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      const ins = (imp: number) => sql`INSERT INTO compra_percepciones (tenant_id, compra_id, alegra_perception_id, nombre, importe_centavos)
        VALUES (${T_A}, ${id}, 'uuid-ejemplo', 'IIBB ejemplo', ${imp})`
      expect(await codigoDeError(() => ins(0))).toBe("23514")
      expect(await codigoDeError(() => ins(3000))).toBeNull()
    })
  })

  describe("compra_recepciones", () => {
    it("una sola recepción en vuelo (pendiente o incierta) por compra", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      await recepcion(T_A, id, 1, "k1", "pendiente")
      expect(await codigoDeError(() => recepcion(T_A, id, 2, "k2", "pendiente"))).toBe("23505")
      expect(await codigoDeError(() => recepcion(T_A, id, 2, "k2", "incierta"))).toBe("23505")
      // las terminadas no cuentan
      expect(await codigoDeError(() => recepcion(T_A, id, 2, "k2", "aplicada"))).toBeNull()
      expect(await codigoDeError(() => recepcion(T_A, id, 3, "k3", "fallida"))).toBeNull()
      // al resolverse la primera, entra otra
      await sql`UPDATE compra_recepciones SET estado = 'aplicada' WHERE compra_id = ${id} AND secuencia = 1`
      expect(await codigoDeError(() => recepcion(T_A, id, 4, "k4", "pendiente"))).toBeNull()
    })

    it("secuencia e idempotency_key únicas por compra; dos compras pueden repetirlas", async () => {
      const c = await cuenta(T_A, "aaa")
      const a = await compra(T_A, c)
      const b = await compra(T_A, c)
      await recepcion(T_A, a, 1, "k1", "aplicada")
      expect(await codigoDeError(() => recepcion(T_A, a, 1, "otra", "aplicada"))).toBe("23505")
      expect(await codigoDeError(() => recepcion(T_A, a, 2, "k1", "aplicada"))).toBe("23505")
      expect(await codigoDeError(() => recepcion(T_A, b, 1, "k1", "aplicada"))).toBeNull()
    })

    it("estado válido y secuencia positiva", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      expect(await codigoDeError(() => recepcion(T_A, id, 1, "k1", "rara"))).toBe("23514")
      expect(await codigoDeError(() => recepcion(T_A, id, 0, "k0", "aplicada"))).toBe("23514")
    })

    it("FK compuesta: otro tenant se rechaza", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      expect(await codigoDeError(() => recepcion(T_B, id, 1, "k1"))).toBe("23503")
    })
  })

  describe("compra_recepcion_items", () => {
    it("cantidad > 0, PK (recepción, ítem) y FK compuestas", async () => {
      const c = await cuenta(T_A, "aaa")
      const id = await compra(T_A, c)
      const [{ id: itemId }] = await item(T_A, id, 1)
      const [{ id: recId }] = await recepcion(T_A, id, 1, "k1", "aplicada")
      const ins = (tenant: string, cant: string) =>
        sql`INSERT INTO compra_recepcion_items (tenant_id, recepcion_id, compra_item_id, cantidad, monto_neto_e5)
          VALUES (${tenant}, ${recId}, ${itemId}, ${cant}, 40000000)`
      expect(await codigoDeError(() => ins(T_A, "0"))).toBe("23514")
      expect(await codigoDeError(() => ins(T_B, "4"))).toBe("23503")
      expect(await codigoDeError(() => ins(T_A, "4"))).toBeNull()
      expect(await codigoDeError(() => ins(T_A, "4"))).toBe("23505")
    })
  })

  describe("alegra_compras_config", () => {
    it("una fila por cuenta; las percepciones son un mapa nombre -> idPerception", async () => {
      const c = await cuenta(T_A, "aaa")
      await sql`INSERT INTO alegra_compras_config (tenant_id, cuenta_id, categoria_transito_id, percepciones)
        VALUES (${T_A}, ${c}, '5246', ${sql.json({ "IIBB ejemplo": "uuid-ejemplo" })})`
      expect(
        await codigoDeError(
          () => sql`INSERT INTO alegra_compras_config (tenant_id, cuenta_id) VALUES (${T_A}, ${c})`,
        ),
      ).toBe("23505")
      const [{ p }] = await sql`SELECT percepciones AS p FROM alegra_compras_config WHERE cuenta_id = ${c}`
      expect(p).toEqual({ "IIBB ejemplo": "uuid-ejemplo" })
    })

    it("la config no puede apuntar a una cuenta de otro tenant y se borra con la cuenta", async () => {
      const cB = await cuenta(T_B, "bbb")
      expect(
        await codigoDeError(() => sql`INSERT INTO alegra_compras_config (tenant_id, cuenta_id) VALUES (${T_A}, ${cB})`),
      ).toBe("23503")
      const cA = await cuenta(T_A, "aaa")
      await sql`INSERT INTO alegra_compras_config (tenant_id, cuenta_id) VALUES (${T_A}, ${cA})`
      await sql`DELETE FROM alegra_cuentas WHERE id = ${cA}`
      expect((await sql`SELECT 1 FROM alegra_compras_config WHERE cuenta_id = ${cA}`).length).toBe(0)
    })
  })
})

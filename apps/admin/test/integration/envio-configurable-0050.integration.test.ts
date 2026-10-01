import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { guardarEnvio, guardarReglasVenta, leerEnvio, leerReglasVenta } from "@/lib/reglas-venta-repo"
import { ENVIO_DEFAULT } from "@/lib/envios-validacion"
import { REGLAS_VENTA_DEFAULT } from "@/lib/reglas-venta-validacion"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0050 (change `envio-gratis-configurable`, rebanada A) contra la base real de test:
 * defaults, los 4 CHECK de `reglas_venta` y el repo de envío (upsert que no pisa las otras reglas).
 * Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})
afterAll(async () => {
  await truncateAll()
})

const insertarFila = (tenant: string) => getDb().execute(sql`insert into reglas_venta (tenant_id) values (${tenant}) on conflict do nothing`)

describe("0050: defaults y CHECK", () => {
  it("una fila nueva queda con domicilio activo, gratis apagado y sin configurar", async () => {
    await insertarFila(A)
    expect(await leerEnvio(A)).toEqual(ENVIO_DEFAULT)
  })

  it("una fila preexistente a la migración recibe los mismos defaults (ADD COLUMN con DEFAULT)", async () => {
    // Las filas se siembran en 0045 y las columnas se agregan con DEFAULT: el resultado de un
    // INSERT sin columnas de envío es exactamente el de una fila previa.
    await insertarFila(B)
    const r = await getDb().execute(
      sql`select envio_domicilio_activo, envio_gratis_activo, envio_gratis_alcance, envio_gratis_provincias, envio_gratis_minimo_modo, envio_gratis_minimo from reglas_venta where tenant_id = ${B}`,
    )
    expect(r[0]).toEqual({
      envio_domicilio_activo: true,
      envio_gratis_activo: false,
      envio_gratis_alcance: null,
      envio_gratis_provincias: [],
      envio_gratis_minimo_modo: null,
      envio_gratis_minimo: null,
    })
  })

  it("gratis activo sin alcance ni modo viola el CHECK (INSERT y UPDATE)", async () => {
    await expect(getDb().execute(sql`insert into reglas_venta (tenant_id, envio_gratis_activo) values (${A}, true)`)).rejects.toThrow()
    await insertarFila(A)
    await expect(getDb().execute(sql`update reglas_venta set envio_gratis_activo = true where tenant_id = ${A}`)).rejects.toThrow()
    await expect(
      getDb().execute(sql`update reglas_venta set envio_gratis_activo = true, envio_gratis_alcance = 'pais' where tenant_id = ${A}`),
    ).rejects.toThrow()
  })

  it("modo 'desde' sin monto con gratis activo viola el CHECK", async () => {
    await insertarFila(A)
    await expect(
      getDb().execute(
        sql`update reglas_venta set envio_gratis_activo = true, envio_gratis_alcance = 'pais', envio_gratis_minimo_modo = 'desde' where tenant_id = ${A}`,
      ),
    ).rejects.toThrow()
  })

  it("monto cero o negativo viola el CHECK", async () => {
    await insertarFila(A)
    await expect(getDb().execute(sql`update reglas_venta set envio_gratis_minimo = 0 where tenant_id = ${A}`)).rejects.toThrow()
    await expect(getDb().execute(sql`update reglas_venta set envio_gratis_minimo = -1 where tenant_id = ${A}`)).rejects.toThrow()
  })

  it("alcance y modo desconocidos violan el CHECK", async () => {
    await insertarFila(A)
    await expect(getDb().execute(sql`update reglas_venta set envio_gratis_alcance = 'mundo' where tenant_id = ${A}`)).rejects.toThrow()
    await expect(getDb().execute(sql`update reglas_venta set envio_gratis_minimo_modo = 'otro' where tenant_id = ${A}`)).rejects.toThrow()
  })

  it("gratis activo con todo configurado es válido, y apagarlo conserva los datos", async () => {
    await insertarFila(A)
    await getDb().execute(
      sql`update reglas_venta set envio_gratis_activo = true, envio_gratis_alcance = 'provincias', envio_gratis_provincias = '{misiones}', envio_gratis_minimo_modo = 'desde', envio_gratis_minimo = 100000 where tenant_id = ${A}`,
    )
    await getDb().execute(sql`update reglas_venta set envio_gratis_activo = false where tenant_id = ${A}`)
    expect(await leerEnvio(A)).toEqual({
      domicilioActivo: true,
      gratisActivo: false,
      alcance: "provincias",
      provincias: ["misiones"],
      minimoModo: "desde",
      minimo: 100000,
    })
  })
})

describe("repo de envío", () => {
  it("sin fila devuelve los defaults", async () => {
    expect(await leerEnvio(A)).toEqual(ENVIO_DEFAULT)
  })

  it("guarda y lee la configuración completa (provincias como claves, monto numérico)", async () => {
    const r = await guardarEnvio(A, {
      domicilioActivo: true,
      gratisActivo: true,
      alcance: "provincias",
      provincias: ["Misiones", "Corrientes"],
      minimoModo: "desde",
      minimo: "100000",
    })
    expect(r).toEqual({
      kind: "ok",
      envio: { domicilioActivo: true, gratisActivo: true, alcance: "provincias", provincias: ["misiones", "corrientes"], minimoModo: "desde", minimo: 100000 },
    })
    expect(await leerEnvio(A)).toEqual((r as { envio: unknown }).envio)
  })

  it("un cuerpo inválido no toca la base", async () => {
    const r = await guardarEnvio(A, { domicilioActivo: true, gratisActivo: true, alcance: "pais", minimoModo: "desde", minimo: 0 })
    expect(r).toMatchObject({ kind: "invalid", campo: "minimo" })
    expect(await leerEnvio(A)).toEqual(ENVIO_DEFAULT)
  })

  it("guardar el envío no altera las otras reglas, y viceversa", async () => {
    await guardarReglasVenta(A, { reservaDias: 30, mensajeConfirmacion: "Gracias." })
    await guardarEnvio(A, { domicilioActivo: false, gratisActivo: false })
    expect(await leerReglasVenta(A)).toEqual({ ...REGLAS_VENTA_DEFAULT, reservaDias: 30, mensajeConfirmacion: "Gracias." })

    await guardarEnvio(A, { domicilioActivo: true, gratisActivo: true, alcance: "pais", minimoModo: "sin_minimo" })
    await guardarReglasVenta(A, { trasladoDias: 3 })
    expect(await leerEnvio(A)).toMatchObject({ domicilioActivo: true, gratisActivo: true, alcance: "pais", minimoModo: "sin_minimo" })
  })

  it("cada tenant tiene su envío", async () => {
    await guardarEnvio(A, { domicilioActivo: false, gratisActivo: false })
    expect((await leerEnvio(B)).domicilioActivo).toBe(true)
    expect((await leerEnvio(A)).domicilioActivo).toBe(false)
  })
})

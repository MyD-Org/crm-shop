import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  actualizarMedioPago,
  crearMedioPago,
  eliminarMedioPago,
  listarMediosPago,
  nombresMediosPago,
} from "@/lib/medios-pago-shop-repo"
import { guardarReglasVenta, leerReglasVenta } from "@/lib/reglas-venta-repo"
import { seedShopOrder, seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0046 (change `sucursales-igz-mdp`, rebanada C) contra la base real de test:
 * `medios_pago_shop` (alta, 409 por slug repetido, aislamiento por tenant, borrado bloqueado por
 * `shop.orders.pago_metodo`, CHECK del slug) y `reglas_venta.mensaje_confirmacion`. Datos inventados.
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

describe("medios_pago_shop", () => {
  it("alta con defaults, listado ordenado y aislado por tenant", async () => {
    const r = await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia bancaria", orden: 2 })
    expect(r).toMatchObject({ kind: "ok", medio: { slug: "transferencia", activo: true, aplicaRetiro: true, aplicaEnvio: true, cobroOnline: false, instrucciones: "" } })
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo en el local", aplicaEnvio: false, orden: 1 })
    await crearMedioPago(B, { slug: "otro", nombre: "Otro" })

    expect((await listarMediosPago(A)).map((m) => m.slug)).toEqual(["efectivo", "transferencia"])
    expect((await listarMediosPago(B)).map((m) => m.slug)).toEqual(["otro"])
    expect(await nombresMediosPago(A)).toEqual({ transferencia: "Transferencia bancaria", efectivo: "Efectivo en el local" })
  })

  it("slug repetido en el mismo tenant → conflict; en otro tenant se permite", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    expect(await crearMedioPago(A, { slug: "efectivo", nombre: "Otra vez" })).toEqual({
      kind: "conflict",
      campo: "slug",
      error: "Ya existe un medio de pago con ese identificador.",
    })
    expect((await crearMedioPago(B, { slug: "efectivo", nombre: "Efectivo" })).kind).toBe("ok")
  })

  it("actualiza parcialmente, mantiene el slug y rechaza dejar sin entrega; otro tenant → not_found", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo", aplicaEnvio: false })
    const r = await actualizarMedioPago(A, "efectivo", { nombre: "Efectivo en caja", instrucciones: "Pague al retirar.", activo: false })
    expect(r).toMatchObject({ kind: "ok", medio: { slug: "efectivo", nombre: "Efectivo en caja", instrucciones: "Pague al retirar.", activo: false } })
    expect(await actualizarMedioPago(A, "efectivo", { aplicaRetiro: false })).toMatchObject({ kind: "invalid", campo: "aplicaRetiro" })
    expect(await actualizarMedioPago(B, "efectivo", { activo: true })).toEqual({ kind: "not_found" })
  })

  it("borra si ningún pedido lo usa; si un pedido del tenant lo eligió → conflict; el de otro tenant no cuenta", async () => {
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo" })
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    await crearMedioPago(B, { slug: "transferencia", nombre: "Transferencia" })
    await seedShopOrder(A, { pagoMetodo: "transferencia" })

    expect(await eliminarMedioPago(A, "efectivo")).toEqual({ kind: "ok" })
    expect(await eliminarMedioPago(A, "efectivo")).toEqual({ kind: "not_found" })
    expect(await eliminarMedioPago(A, "transferencia")).toEqual({
      kind: "conflict",
      error: "Hay pedidos que eligieron este medio de pago. Desactívelo en lugar de eliminarlo.",
    })
    // El pedido es del tenant A: no bloquea el borrado del mismo slug en B.
    expect(await eliminarMedioPago(B, "transferencia")).toEqual({ kind: "ok" })
  })

  it("el CHECK de la base rechaza un slug fuera del patrón", async () => {
    await expect(
      getDb().execute(sql`insert into medios_pago_shop (tenant_id, slug, nombre) values (${A}, 'Mal Slug', 'x')`),
    ).rejects.toThrow()
  })
})

describe("reglas_venta.mensaje_confirmacion", () => {
  it("nace vacío, se guarda recortado y se conserva al cambiar otro campo", async () => {
    expect((await leerReglasVenta(A)).mensajeConfirmacion).toBe("")
    await guardarReglasVenta(A, { mensajeConfirmacion: "  Le escribiremos en {plazo}. WhatsApp: {whatsapp}.  " })
    expect((await leerReglasVenta(A)).mensajeConfirmacion).toBe("Le escribiremos en {plazo}. WhatsApp: {whatsapp}.")
    await guardarReglasVenta(A, { reservaDias: 3 })
    expect((await leerReglasVenta(A)).mensajeConfirmacion).toBe("Le escribiremos en {plazo}. WhatsApp: {whatsapp}.")
    expect(await guardarReglasVenta(A, { mensajeConfirmacion: "Hola {nombre}" })).toMatchObject({ kind: "invalid", campo: "mensajeConfirmacion" })
  })
})

describe("fila fija mercadopago (migración 0057)", () => {
  const sqlMigracion = readFileSync(new URL("../../drizzle/0057_medio_pago_mercadopago.sql", import.meta.url), "utf8")
  const correrMigracion = async () => {
    for (const parte of sqlMigracion.split("--> statement-breakpoint")) await getDb().execute(sql.raw(parte))
  }

  it("siembra una fila inactiva por tenant, al final del orden, y es idempotente", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia", orden: 0 })
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo", orden: 5 })

    await correrMigracion()
    await correrMigracion()

    const a = await listarMediosPago(A)
    expect(a.filter((m) => m.slug === "mercadopago")).toEqual([
      { slug: "mercadopago", nombre: "Mercado Pago", instrucciones: "", activo: false, aplicaRetiro: true, aplicaEnvio: true, cobroOnline: true, orden: 6, listaOnlineId: null, listaOnlineNombre: null, listaOnlineActiva: false, condicionesCuotas: [], destacarEnCatalogo: false, mostrarEnFicha: false, audiencia: "publico", chips: [], opcionesCobro: ["credito", "debito", "cuenta_mp"], listasPorForma: [] },
    ])
    expect((await listarMediosPago(B)).filter((m) => m.slug === "mercadopago")).toHaveLength(1)
  })

  it("no pisa una fila que ya existe", async () => {
    await getDb().execute(
      sql`insert into medios_pago_shop (tenant_id, slug, nombre, activo, cobro_online, orden) values (${A}, 'mercadopago', 'Mercado Pago', true, true, 0)`,
    )
    await correrMigracion()
    expect((await listarMediosPago(A)).find((m) => m.slug === "mercadopago")).toMatchObject({ activo: true, orden: 0 })
  })

  it("no se puede eliminar, pero sí activar y reordenar", async () => {
    await correrMigracion()
    expect(await eliminarMedioPago(A, "mercadopago")).toEqual({
      kind: "conflict",
      error: "Este medio de pago no se puede eliminar; desactívelo.",
    })
    expect(await actualizarMedioPago(A, "mercadopago", { activo: true, orden: 3, aplicaEnvio: false })).toMatchObject({
      kind: "ok",
      medio: { slug: "mercadopago", activo: true, orden: 3, aplicaEnvio: false, cobroOnline: true },
    })
    expect(await actualizarMedioPago(A, "mercadopago", { cobroOnline: false })).toMatchObject({ kind: "ok", medio: { cobroOnline: true } })
  })
})

describe("fila fija payway (migración 0067)", () => {
  const sqlMigracion = readFileSync(new URL("../../drizzle/0067_medio_pago_payway.sql", import.meta.url), "utf8")
  const correrMigracion = async () => {
    for (const parte of sqlMigracion.split("--> statement-breakpoint")) await getDb().execute(sql.raw(parte))
  }

  it("siembra una fila inactiva por tenant, al final del orden, y es idempotente", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia", orden: 0 })
    await crearMedioPago(A, { slug: "efectivo", nombre: "Efectivo", orden: 5 })

    await correrMigracion()
    await correrMigracion()

    const a = await listarMediosPago(A)
    expect(a.filter((m) => m.slug === "payway")).toEqual([
      { slug: "payway", nombre: "Tarjeta de crédito o débito - Payway", instrucciones: "", activo: false, aplicaRetiro: true, aplicaEnvio: true, cobroOnline: true, orden: 6, listaOnlineId: null, listaOnlineNombre: null, listaOnlineActiva: false, condicionesCuotas: [], destacarEnCatalogo: false, mostrarEnFicha: false, audiencia: "publico", chips: [], opcionesCobro: ["credito", "debito", "cuenta_mp"], listasPorForma: [] },
    ])
    expect((await listarMediosPago(B)).filter((m) => m.slug === "payway")).toHaveLength(1)
  })

  it("no pisa una fila que ya existe (ni su nombre editado)", async () => {
    await getDb().execute(
      sql`insert into medios_pago_shop (tenant_id, slug, nombre, activo, cobro_online, orden) values (${A}, 'payway', 'Tarjetas', true, true, 0)`,
    )
    await correrMigracion()
    expect((await listarMediosPago(A)).find((m) => m.slug === "payway")).toMatchObject({ nombre: "Tarjetas", activo: true, orden: 0 })
  })

  it("convive con mercadopago: no se elimina, pero sí se activa, renombra y reordena", async () => {
    await correrMigracion()
    expect(await eliminarMedioPago(A, "payway")).toEqual({
      kind: "conflict",
      error: "Este medio de pago no se puede eliminar; desactívelo.",
    })
    expect(await actualizarMedioPago(A, "payway", { activo: true, orden: 3, nombre: "Tarjetas" })).toMatchObject({
      kind: "ok",
      medio: { slug: "payway", activo: true, orden: 3, nombre: "Tarjetas", cobroOnline: true },
    })
    expect(await actualizarMedioPago(A, "payway", { cobroOnline: false })).toMatchObject({ kind: "ok", medio: { cobroOnline: true } })
  })
})

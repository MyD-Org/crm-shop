import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, compraItems, compras, tenants } from "@/db/schema"
import { buscarBills } from "@/lib/alegra-compras"
import {
  __mockBillsAgregarPago,
  __mockBillsFallar,
  __mockBillsReset,
} from "@/lib/mock-alegra-compras"
import { ErrorCompras } from "@/lib/compras-dinero"
import { obtenerCompra } from "@/lib/compras-repo"
import {
  anularCompra,
  crearCompraDesdeBody,
  DEPS_REALES,
  detalleCompra,
  editarCompraDesdeBody,
  type DepsCompras,
} from "@/lib/compras-service"
import { EMPTY_TENANT } from "@/lib/tenants"
import { assertLocalTestDb, TEST_DATABASE_URL } from "./db-url"

// Servicio de Compras (crear / editar / anular) contra Postgres real (crm_test) y el MOCK de Alegra
// en memoria: nada de esto escribe en Alegra real. Datos inventados.

const T_A = "tenant-svc-a"
const T_B = "tenant-svc-b"
const PROV = "77"
const cuentaSlug = "aaa"
let n = 0

const deps: DepsCompras = {
  ...DEPS_REALES,
  configAlegra: async () => ({ ...EMPTY_TENANT, alegraMock: true }),
  configCompras: async () => ({
    tenantId: T_A,
    cuentaId: "x",
    categoriaTransitoId: null,
    categoriaTransitoNombre: null,
    percepciones: { "Ingresos brutos Buenos Aires": "01a0eef5-e2d9-72c0-bc9c-bd3fc4780117" },
    almacenId: null,
    updatedBy: null,
    updatedAt: new Date(),
  }),
  resolverItems: async (_t, _c, ids) => ({
    ids: new Map(ids.filter((i) => i !== "sin-item").map((i) => [i, `item-${i}`])),
    faltantes: ids.filter((i) => i === "sin-item"),
  }),
  productos: async (_t, ids) => new Map(ids.map((i) => [i, { alegraId: i, codigo: `COD-${i}`, nombre: `Producto ${i}` }])),
}

const cuerpo = (p: Record<string, unknown> = {}) => {
  n += 1
  return {
    cuenta: cuentaSlug,
    idempotencyKey: `clave-servicio-${n}`,
    proveedor: { id: PROV, nombre: "Proveedor Ejemplo" },
    numeroFactura: `0001-${String(n).padStart(8, "0")}`,
    fecha: "2026-11-10",
    vencimiento: "2026-12-10",
    items: [{ alegraId: "p1", cantidad: 10, costo: 100, ivaPorcentaje: 21 }],
    percepciones: [{ nombre: "Ingresos brutos Buenos Aires", importe: 30, certificado: "C-1" }],
    ...p,
  }
}

async function limpiar() {
  const db = getDb()
  await db.delete(compras).where(inArray(compras.tenantId, [T_A, T_B]))
  await db.delete(alegraCuentas).where(inArray(alegraCuentas.tenantId, [T_A, T_B]))
  await db.delete(tenants).where(inArray(tenants.id, [T_A, T_B]))
}

const codigoDe = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e instanceof ErrorCompras ? e.codigo : `otro: ${String(e)}`
  }
  return null
}

describe("compras-service (DB real + mock de Alegra)", () => {
  beforeEach(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    __mockBillsReset()
    await limpiar()
    const db = getDb()
    for (const id of [T_A, T_B]) {
      await db.insert(tenants).values({ id, name: `Tenant ${id}`, logoPath: "/logos/test.svg", resendFrom: "no-responder@plataforma.example" })
    }
    await db.insert(alegraCuentas).values({ tenantId: T_A, slug: "aaa", nombre: "Cuenta A", alegraMock: true })
    await db.insert(alegraCuentas).values({ tenantId: T_B, slug: "bbb", nombre: "Cuenta B", alegraMock: true })
  })

  afterAll(async () => {
    await limpiar()
  })

  it("crea la compra: bill abierta con total = neto + IVA + percepciones y snapshot guardado", async () => {
    const r = await crearCompraDesdeBody(T_A, null, cuerpo(), deps)
    expect(r).toMatchObject({ estado: "pendiente", incierta: false })
    const c = (await obtenerCompra(T_A, r.compraId))!
    expect(c.estado).toBe("pendiente")
    expect(c.netoCentavos).toBe(100_000)
    expect(c.ivaCentavos).toBe(21_000)
    expect(c.percepcionesCentavos).toBe(3_000)
    expect(c.totalCentavos).toBe(124_000)
    expect(c.alegraBillId).toBeTruthy()
    expect(c.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(c.items[0]).toMatchObject({ itemIdCuenta: "item-p1", cantidadPedida: "10.000", taxAlegraId: "1" })
    const [bill] = await buscarBills({ ...EMPTY_TENANT, alegraMock: true }, { proveedorId: PROV, numero: c.numeroFactura })
    expect(bill.totalCentavos).toBe(124_000)
    // Una sola línea de tránsito (categoría), ningún ítem de producto todavía.
    expect(bill.lineas.map((l) => l.tipo)).toEqual(["cat"])
  })

  it("una clave de idempotencia repetida devuelve la misma compra sin duplicar la bill", async () => {
    const body = cuerpo()
    const a = await crearCompraDesdeBody(T_A, null, body, deps)
    const b = await crearCompraDesdeBody(T_A, null, body, deps)
    expect(b.compraId).toBe(a.compraId)
    const bills = await buscarBills({ ...EMPTY_TENANT, alegraMock: true }, { proveedorId: PROV, numero: body.numeroFactura })
    expect(bills).toHaveLength(1)
  })

  it("rechaza un proveedor + número ya cargado, sin tocar Alegra", async () => {
    const body = cuerpo()
    await crearCompraDesdeBody(T_A, null, body, deps)
    const cod = await codigoDe(crearCompraDesdeBody(T_A, null, { ...body, idempotencyKey: "otra-clave-distinta" }, deps))
    expect(cod).toBe("numero_duplicado")
  })

  it("un producto sin ítem en la cuenta bloquea y no deja compra ni bill", async () => {
    const body = cuerpo({ items: [{ alegraId: "sin-item", cantidad: 1, costo: 10, ivaPorcentaje: 21 }] })
    expect(await codigoDe(crearCompraDesdeBody(T_A, null, body, deps))).toBe("item_inexistente")
    expect(await getDb().select().from(compras).where(eq(compras.tenantId, T_A))).toHaveLength(0)
    expect(await buscarBills({ ...EMPTY_TENANT, alegraMock: true }, { proveedorId: PROV, numero: body.numeroFactura })).toHaveLength(0)
  })

  it("una percepción sin configurar bloquea antes de llamar a Alegra", async () => {
    const body = cuerpo({ percepciones: [{ nombre: "Percepción inventada", importe: 5 }] })
    expect(await codigoDe(crearCompraDesdeBody(T_A, null, body, deps))).toBe("percepcion_sin_configurar")
  })

  it("si Alegra rechaza el POST no persiste la compra", async () => {
    const body = cuerpo()
    // Alegra ya tiene una factura propia con ese proveedor + número: el POST responde 400.
    const { crearBill } = await import("@/lib/alegra-compras")
    await crearBill({ ...EMPTY_TENANT, alegraMock: true }, {
      proveedorId: PROV,
      numero: body.numeroFactura,
      fecha: "2026-11-01",
      vencimiento: "2026-12-01",
      almacenId: "wh-mock-1",
      observaciones: "",
      lineas: [{ tipo: "cat", id: "5246", precioCentavos: 100, cantidadMilesimas: 1000, taxIds: ["1"] }],
    })
    expect(await codigoDe(crearCompraDesdeBody(T_A, null, body, deps))).toBe("alegra_rechazo")
    expect(await getDb().select().from(compras).where(eq(compras.tenantId, T_A))).toHaveLength(0)
  })

  it("corte de red tras el POST: queda 'creando' y el reintento adopta la bill por su marcador", async () => {
    const body = cuerpo()
    __mockBillsFallar({ tras: "post", modo: "corte" })
    const r1 = await crearCompraDesdeBody(T_A, null, body, deps)
    // La búsqueda posterior encuentra la bill aplicada: se adopta en la misma llamada.
    expect(r1).toMatchObject({ estado: "pendiente", incierta: false })
    const bills = await buscarBills({ ...EMPTY_TENANT, alegraMock: true }, { proveedorId: PROV, numero: body.numeroFactura })
    expect(bills).toHaveLength(1)
    expect((await obtenerCompra(T_A, r1.compraId))!.alegraBillId).toBe(bills[0].id)
  })

  it("5xx al aplicar las percepciones: queda 'creando' y el detalle la reconcilia", async () => {
    __mockBillsFallar({ tras: "percepciones", modo: "5xx" })
    const r = await crearCompraDesdeBody(T_A, null, cuerpo(), deps)
    expect(r).toMatchObject({ estado: "creando", incierta: true })
    const c = await detalleCompra(T_A, r.compraId, deps)
    expect(c!.estado).toBe("pendiente")
  })

  it("edita cantidades y costos mientras nada se recibió: Alegra y la base quedan al día", async () => {
    const r = await crearCompraDesdeBody(T_A, null, cuerpo(), deps)
    await editarCompraDesdeBody(
      T_A,
      r.compraId,
      { items: [{ alegraId: "p1", cantidad: 20, costo: 50, ivaPorcentaje: 21 }], percepciones: [] },
      deps,
    )
    const c = (await obtenerCompra(T_A, r.compraId))!
    expect(c.totalCentavos).toBe(121_000) // 20 x 50 = 1000 neto + 210 IVA
    expect(c.items).toHaveLength(1)
    expect(c.items[0].cantidadPedida).toBe("20.000")
    expect(c.percepcionesDetalle).toHaveLength(0)
    const [bill] = await buscarBills({ ...EMPTY_TENANT, alegraMock: true }, { proveedorId: PROV, numero: c.numeroFactura })
    expect(bill.totalCentavos).toBe(121_000)
  })

  it("no edita ni anula una compra con un pago registrado en Alegra", async () => {
    const r = await crearCompraDesdeBody(T_A, null, cuerpo(), deps)
    const c = (await obtenerCompra(T_A, r.compraId))!
    __mockBillsAgregarPago(c.alegraBillId!, 1_000)
    const e = await editarCompraDesdeBody(T_A, r.compraId, { items: cuerpo().items, percepciones: [] }, deps).catch((x) => x)
    expect(e).toBeInstanceOf(ErrorCompras)
    expect((e as ErrorCompras).codigo).toBe("con_pagos")
    expect(await codigoDe(anularCompra(T_A, r.compraId, deps))).toBe("con_pagos")
  })

  it("anula la compra pendiente: borra la bill y marca 'anulada' (y es idempotente)", async () => {
    const r = await crearCompraDesdeBody(T_A, null, cuerpo(), deps)
    const c = (await obtenerCompra(T_A, r.compraId))!
    await anularCompra(T_A, r.compraId, deps)
    expect((await obtenerCompra(T_A, r.compraId))!.estado).toBe("anulada")
    expect(await buscarBills({ ...EMPTY_TENANT, alegraMock: true }, { proveedorId: PROV, numero: c.numeroFactura })).toHaveLength(0)
    await anularCompra(T_A, r.compraId, deps)
    // El proveedor + número quedan libres para volver a cargar.
    const otra = await crearCompraDesdeBody(T_A, null, { ...cuerpo(), numeroFactura: c.numeroFactura }, deps)
    expect(otra.estado).toBe("pendiente")
  })

  it("con mercadería recibida no se puede editar ni anular", async () => {
    const r = await crearCompraDesdeBody(T_A, null, cuerpo(), deps)
    await getDb().update(compraItems).set({ cantidadRecibida: sql`1` }).where(eq(compraItems.compraId, r.compraId))
    const esperado = "La compra ya tiene mercadería recibida y no puede modificarse ni anularse."
    const e1 = await anularCompra(T_A, r.compraId, deps).catch((x) => x)
    expect((e1 as Error).message).toBe(esperado)
    const e2 = await editarCompraDesdeBody(T_A, r.compraId, { items: cuerpo().items }, deps).catch((x) => x)
    expect((e2 as Error).message).toBe(esperado)
  })

  it("aísla por tenant: otro tenant no puede anular ni editar la compra", async () => {
    const r = await crearCompraDesdeBody(T_A, null, cuerpo(), deps)
    expect(await codigoDe(anularCompra(T_B, r.compraId, deps))).toBe("no_encontrada")
    expect(await codigoDe(editarCompraDesdeBody(T_B, r.compraId, { items: [] }, deps))).toBe("no_encontrada")
    expect(await detalleCompra(T_B, r.compraId, deps)).toBeNull()
  })
})

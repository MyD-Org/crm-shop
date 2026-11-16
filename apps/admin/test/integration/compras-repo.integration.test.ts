import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, compras, tenants } from "@/db/schema"
import { ErrorCompras } from "@/lib/compras-dinero"
import {
  actualizarCompra,
  actualizarRecepcion,
  conLockCompra,
  crearCompra,
  insertarRecepcion,
  listarCompras,
  obtenerCompra,
  recalcularRecibido,
  recepcionesEnVuelo,
  recibidoAplicadoPorItem,
  type NuevaCompra,
} from "@/lib/compras-repo"
import { assertLocalTestDb, TEST_DATABASE_URL } from "./db-url"

// compras-repo contra Postgres real (crm_test): aislamiento por tenant, idempotencia, caché de lo
// recibido = Σ de recepciones aplicadas y serialización por el lock advisory. Datos inventados.

const T_A = "tenant-rep-a"
const T_B = "tenant-rep-b"

let cuentaA = ""
let cuentaB = ""
let n = 0

async function limpiar() {
  const db = getDb()
  // compra_* caen en cascada con compras; la config y las cuentas se borran aparte.
  await db.delete(compras).where(inArray(compras.tenantId, [T_A, T_B]))
  await db.delete(alegraCuentas).where(inArray(alegraCuentas.tenantId, [T_A, T_B]))
  await db.delete(tenants).where(inArray(tenants.id, [T_A, T_B]))
}

const base = (cuentaId: string, p: Partial<NuevaCompra> = {}): NuevaCompra => {
  n += 1
  return {
    cuentaId,
    proveedorAlegraId: "77",
    proveedorNombre: "Proveedor Ejemplo",
    numeroFactura: `A-${n}`,
    fecha: "2026-11-01",
    vencimiento: "2026-12-01",
    almacenId: "alm-1",
    idempotencyKey: `clave-${n}`,
    netoCentavos: 200_000,
    ivaCentavos: 42_000,
    percepcionesCentavos: 3_000,
    totalCentavos: 245_000,
    items: [
      {
        alegraId: "p1",
        itemIdCuenta: "694",
        codigo: "CAB-1",
        nombre: "Cable ejemplo",
        cantidadPedida: "10.000",
        costoUnitarioCentavos: 10_000,
        ivaPorcentaje: "21.00",
        taxAlegraId: "1",
        netoE5: 100_000_000,
      },
      {
        alegraId: "p2",
        itemIdCuenta: "695",
        nombre: "Ficha ejemplo",
        cantidadPedida: "5.000",
        costoUnitarioCentavos: 20_000,
        ivaPorcentaje: "21.00",
        taxAlegraId: "1",
        netoE5: 100_000_000,
      },
    ],
    percepciones: [{ alegraPerceptionId: "uuid-ejemplo", nombre: "IIBB ejemplo", importeCentavos: 3_000 }],
    ...p,
  }
}

const recep = (tx: Parameters<Parameters<typeof conLockCompra>[2]>[0], tenant: string, compraId: string, key: string, itemId: string, cant: string) =>
  insertarRecepcion(tx, tenant, compraId, {
    idempotencyKey: key,
    fecha: "2026-11-02",
    lineasAntesHash: "h1",
    lineasEsperadasHash: "h2",
    totalAntesCentavos: 245_000,
    items: [{ compraItemId: itemId, cantidad: cant, montoNetoE5: 1 }],
  })

describe("compras-repo (DB real)", () => {
  beforeEach(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    await limpiar()
    const db = getDb()
    for (const id of [T_A, T_B]) {
      await db.insert(tenants).values({ id, name: `Tenant ${id}`, logoPath: "/logos/test.svg", resendFrom: "no-responder@plataforma.example" })
    }
    const [a] = await db
      .insert(alegraCuentas)
      .values({ tenantId: T_A, slug: "aaa", nombre: "Cuenta A", alegraEmail: "x@cliente.example", alegraToken: "token-de-prueba-1234" })
      .returning({ id: alegraCuentas.id })
    const [b] = await db
      .insert(alegraCuentas)
      .values({ tenantId: T_B, slug: "bbb", nombre: "Cuenta B", alegraEmail: "y@cliente.example", alegraToken: "token-de-prueba-5678" })
      .returning({ id: alegraCuentas.id })
    cuentaA = a.id
    cuentaB = b.id
  })

  afterAll(async () => {
    await limpiar()
  })

  it("crea la compra con ítems y percepciones y la lee completa", async () => {
    const { id, creada } = await crearCompra(T_A, base(cuentaA))
    expect(creada).toBe(true)
    const c = await obtenerCompra(T_A, id)
    expect(c?.estado).toBe("creando")
    expect(c?.items.map((i) => i.orden)).toEqual([1, 2])
    expect(c?.items[0].cantidadPedida).toBe("10.000")
    expect(c?.percepcionesDetalle).toHaveLength(1)
    expect(c?.recepciones).toEqual([])
  })

  it("aislamiento por tenant: B no ve, no lista ni toma el lock de las compras de A", async () => {
    const { id } = await crearCompra(T_A, base(cuentaA))
    await crearCompra(T_B, base(cuentaB))
    expect(await obtenerCompra(T_B, id)).toBeNull()
    expect((await listarCompras(T_A)).map((c) => c.id)).toEqual([id])
    expect(await listarCompras(T_B)).toHaveLength(1)
    await expect(conLockCompra(T_B, id, async () => 1)).rejects.toMatchObject({ codigo: "no_encontrada" })
    // el tenant B tampoco puede crear una compra sobre la cuenta de A (FK compuesta)
    await expect(crearCompra(T_B, base(cuentaA))).rejects.toBeTruthy()
  })

  it("una clave de idempotencia repetida devuelve la misma compra sin duplicar", async () => {
    const datos = base(cuentaA)
    const a = await crearCompra(T_A, datos)
    const b = await crearCompra(T_A, { ...datos, numeroFactura: "OTRO" })
    expect(b).toEqual({ id: a.id, creada: false })
    expect(await listarCompras(T_A)).toHaveLength(1)
  })

  it("proveedor + número repetidos: error de dominio en usted; anulada libera el número", async () => {
    const datos = base(cuentaA, { proveedorAlegraId: "9", numeroFactura: "F-1" })
    const a = await crearCompra(T_A, datos)
    await expect(crearCompra(T_A, { ...datos, idempotencyKey: "otra" })).rejects.toBeInstanceOf(ErrorCompras)
    await expect(crearCompra(T_A, { ...datos, idempotencyKey: "otra" })).rejects.toThrow(/Ya existe una compra/)
    await actualizarCompra(getDb(), T_A, a.id, { estado: "anulada" })
    await expect(crearCompra(T_A, { ...datos, idempotencyKey: "otra" })).resolves.toMatchObject({ creada: true })
  })

  it("listado: filtros por estado, cuenta y texto; límite acotado", async () => {
    const a = await crearCompra(T_A, base(cuentaA, { proveedorNombre: "Cables del Sur", numeroFactura: "X-100" }))
    await crearCompra(T_A, base(cuentaA, { proveedorNombre: "Lámparas Norte", numeroFactura: "Y-200" }))
    await actualizarCompra(getDb(), T_A, a.id, { estado: "pendiente" })
    expect((await listarCompras(T_A, { estado: "pendiente" })).map((c) => c.id)).toEqual([a.id])
    expect(await listarCompras(T_A, { q: "cables" })).toHaveLength(1)
    expect(await listarCompras(T_A, { q: "y-2" })).toHaveLength(1)
    expect(await listarCompras(T_A, { q: "%" })).toHaveLength(0) // el comodín se escapa
    expect(await listarCompras(T_A, { cuentaId: cuentaB })).toHaveLength(0)
    expect(await listarCompras(T_A, { limit: 1 })).toHaveLength(1)
  })

  it("lo recibido es Σ de recepciones aplicadas: la caché coincide y las fallidas no cuentan", async () => {
    const { id } = await crearCompra(T_A, base(cuentaA))
    const c = (await obtenerCompra(T_A, id))!
    const [i1, i2] = c.items
    // recepción 1 (aplicada): 4 del ítem 1
    const r1 = await conLockCompra(T_A, id, async (tx) => {
      const r = await recep(tx, T_A, id, "k1", i1.id, "4.000")
      await actualizarRecepcion(tx, T_A, r.id, { estado: "aplicada", aplicadaAt: new Date() })
      await recalcularRecibido(tx, T_A, id)
      return r
    })
    expect(r1.secuencia).toBe(1)
    // recepción 2 (fallida): no cuenta
    await conLockCompra(T_A, id, async (tx) => {
      const r = await recep(tx, T_A, id, "k2", i1.id, "3.000")
      await actualizarRecepcion(tx, T_A, r.id, { estado: "fallida", motivoFallo: "rechazada" })
      await recalcularRecibido(tx, T_A, id)
    })
    // recepción 3 (aplicada): 1,5 del ítem 1 y no del 2
    await conLockCompra(T_A, id, async (tx) => {
      const r = await recep(tx, T_A, id, "k3", i1.id, "1.500")
      await actualizarRecepcion(tx, T_A, r.id, { estado: "aplicada" })
      await recalcularRecibido(tx, T_A, id)
    })
    const verdad = await recibidoAplicadoPorItem(T_A, id)
    const despues = (await obtenerCompra(T_A, id))!
    expect(verdad.get(i1.id)).toBe("5.500")
    expect(verdad.has(i2.id)).toBe(false)
    for (const it of despues.items) {
      expect(it.cantidadRecibida).toBe(verdad.get(it.id) ? Number(verdad.get(it.id)).toFixed(3) : "0.000")
    }
    expect(despues.recepciones.map((r) => [r.secuencia, r.estado])).toEqual([
      [1, "aplicada"],
      [2, "fallida"],
      [3, "aplicada"],
    ])
  })

  it("la caché no puede exceder lo pedido (CHECK) aunque la recepción lo intente", async () => {
    const { id } = await crearCompra(T_A, base(cuentaA))
    const [i1] = (await obtenerCompra(T_A, id))!.items
    await expect(
      conLockCompra(T_A, id, async (tx) => {
        const r = await recep(tx, T_A, id, "k1", i1.id, "10.001")
        await actualizarRecepcion(tx, T_A, r.id, { estado: "aplicada" })
        await recalcularRecibido(tx, T_A, id)
      }),
    ).rejects.toBeTruthy()
    expect((await obtenerCompra(T_A, id))!.recepciones).toHaveLength(0) // la transacción se revirtió
  })

  it("misma clave de recepción: devuelve la existente sin duplicar", async () => {
    const { id } = await crearCompra(T_A, base(cuentaA))
    const [i1] = (await obtenerCompra(T_A, id))!.items
    const a = await conLockCompra(T_A, id, (tx) => recep(tx, T_A, id, "k1", i1.id, "2.000"))
    const b = await conLockCompra(T_A, id, (tx) => recep(tx, T_A, id, "k1", i1.id, "2.000"))
    expect(b).toEqual({ id: a.id, secuencia: 1, creada: false })
  })

  it("dos recepciones en vuelo sobre la misma compra: la segunda recibe 'recepcion_en_curso'", async () => {
    const { id } = await crearCompra(T_A, base(cuentaA))
    const [i1] = (await obtenerCompra(T_A, id))!.items
    await conLockCompra(T_A, id, (tx) => recep(tx, T_A, id, "k1", i1.id, "1.000"))
    await expect(conLockCompra(T_A, id, (tx) => recep(tx, T_A, id, "k2", i1.id, "1.000"))).rejects.toMatchObject({
      codigo: "recepcion_en_curso",
    })
    expect(await recepcionesEnVuelo(T_A, id)).toHaveLength(1)
  })

  it("concurrencia: el lock serializa; dos intentos simultáneos dejan una sola recepción en vuelo", async () => {
    const { id } = await crearCompra(T_A, base(cuentaA))
    const [i1] = (await obtenerCompra(T_A, id))!.items
    const resultados = await Promise.allSettled([
      conLockCompra(T_A, id, (tx) => recep(tx, T_A, id, "ka", i1.id, "1.000")),
      conLockCompra(T_A, id, (tx) => recep(tx, T_A, id, "kb", i1.id, "1.000")),
    ])
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const rechazo = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult
    expect(rechazo.reason).toMatchObject({ codigo: "recepcion_en_curso" })
    expect(await recepcionesEnVuelo(T_A, id)).toHaveLength(1)
  })

  it("concurrencia: recepciones que terminan en la misma transacción reciben secuencias 1..N sin huecos", async () => {
    const { id } = await crearCompra(T_A, base(cuentaA))
    const [i1] = (await obtenerCompra(T_A, id))!.items
    await Promise.all(
      Array.from({ length: 6 }, (_, k) =>
        conLockCompra(T_A, id, async (tx) => {
          const r = await recep(tx, T_A, id, `k${k}`, i1.id, "1.000")
          await actualizarRecepcion(tx, T_A, r.id, { estado: "aplicada" })
          await recalcularRecibido(tx, T_A, id)
        }),
      ),
    )
    const c = (await obtenerCompra(T_A, id))!
    expect(c.recepciones.map((r) => r.secuencia)).toEqual([1, 2, 3, 4, 5, 6])
    expect(c.items[0].cantidadRecibida).toBe("6.000")
  })
})

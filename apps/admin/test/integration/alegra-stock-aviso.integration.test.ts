import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraDocumentoItems, alegraItemRefresh, alegraWebhookAvisos } from "@/db/schema"
import { registrarAviso } from "@/lib/alegra-stock-webhook"
import { seedTenant, truncateAll } from "./helpers"

// Avisos de stock de Alegra → índice documento→ítems + cola de re-lectura, contra Postgres
// real (crm_test). Sin Alegra: registrar un aviso no hace requests. Fixtures inventados con
// la forma de la prueba real del 2026-09-24.

const A = "tenant-a"
const B = "tenant-b"

const factura = (id: string, status: string, items: number[]) => ({
  subject: "x",
  message: { invoice: { id, status, client: { name: "Cliente Ejemplo" }, items: items.map((i) => ({ id: i, quantity: 1 })) } },
})
const compra = (id: string, state: string, items: number[]) => ({
  subject: "x",
  message: { bill: { id, state, client: { name: "Proveedor Ejemplo" }, items: items.map((i) => ({ id: i, quantity: 1 })) } },
})

async function cola(tenant = A) {
  const rows = await getDb().select().from(alegraItemRefresh).where(eq(alegraItemRefresh.tenantId, tenant))
  return rows.map((r) => r.alegraId).sort()
}

async function indice(tipo: string, docId: string, tenant = A) {
  const [row] = await getDb()
    .select()
    .from(alegraDocumentoItems)
    .where(and(eq(alegraDocumentoItems.tenantId, tenant), eq(alegraDocumentoItems.tipo, tipo), eq(alegraDocumentoItems.alegraDocId, docId)))
  return row ? [...row.itemIds].sort() : null
}

async function vaciarCola() {
  await getDb().delete(alegraItemRefresh)
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})

afterAll(async () => {
  await truncateAll()
})

describe("registrarAviso", () => {
  it("factura nueva: encola sus ítems e indexa el documento", async () => {
    const r = await registrarAviso(A, "new-invoice", factura("10", "open", [5, 7]))
    expect(r).toMatchObject({ accion: "encolado", docId: "10", encolados: 2 })
    expect(await cola()).toEqual(["5", "7"])
    expect(await indice("invoice", "10")).toEqual(["5", "7"])
  })

  it("edición que quita un ítem: encola {5,7} y el índice queda {5}", async () => {
    await registrarAviso(A, "new-invoice", factura("10", "open", [5, 7]))
    await vaciarCola()
    const r = await registrarAviso(A, "edit-invoice", factura("10", "open", [5]))
    expect(r.encolados).toBe(2)
    expect(await cola()).toEqual(["5", "7"])
    expect(await indice("invoice", "10")).toEqual(["5"])
  })

  it("delete-invoice con items vacío usa el índice y lo borra", async () => {
    await registrarAviso(A, "new-invoice", factura("10", "open", [5, 7]))
    await vaciarCola()
    const r = await registrarAviso(A, "delete-invoice", factura("10", "open", []))
    expect(r.accion).toBe("encolado")
    expect(await cola()).toEqual(["5", "7"])
    expect(await indice("invoice", "10")).toBeNull()
  })

  it("delete de un documento desconocido: sin_indice y nada encolado", async () => {
    const r = await registrarAviso(A, "delete-invoice", factura("99", "open", []))
    expect(r.accion).toBe("sin_indice")
    expect(await cola()).toEqual([])
  })

  it("delete-bill trae ítems: unión con el índice", async () => {
    await registrarAviso(A, "new-bill", compra("33", "open", [8, 9]))
    await vaciarCola()
    await registrarAviso(A, "delete-bill", compra("33", "open", [8]))
    expect(await cola()).toEqual(["8", "9"])
    expect(await indice("bill", "33")).toBeNull()
  })

  it("aviso repetido: sin duplicados en cola ni índice", async () => {
    await registrarAviso(A, "edit-invoice", factura("10", "open", [5, 7]))
    await registrarAviso(A, "edit-invoice", factura("10", "open", [5, 7]))
    expect(await cola()).toEqual(["5", "7"])
    expect(await indice("invoice", "10")).toEqual(["5", "7"])
  })

  it("aislamiento por tenant: B no usa el índice de A", async () => {
    await registrarAviso(A, "new-invoice", factura("10", "open", [5, 7]))
    const r = await registrarAviso(B, "delete-invoice", factura("10", "open", []))
    expect(r.accion).toBe("sin_indice")
    expect(await cola(B)).toEqual([])
    expect(await indice("invoice", "10")).toEqual(["5", "7"])
  })

  it("borrador: no encola, pero el índice queda al día; al abrirse encola la unión", async () => {
    const r = await registrarAviso(A, "new-invoice", factura("11", "draft", [5]))
    expect(r.accion).toBe("borrador")
    expect(await cola()).toEqual([])
    expect(await indice("invoice", "11")).toEqual(["5"])

    const editado = await registrarAviso(A, "edit-invoice", factura("11", "draft", [5, 6]))
    expect(editado.accion).toBe("borrador")
    expect(await cola()).toEqual([])

    await registrarAviso(A, "edit-invoice", factura("11", "open", [5, 6]))
    expect(await cola()).toEqual(["5", "6"])
  })

  it("abierta que pasa a borrador: encola sus ítems (Alegra devuelve el stock)", async () => {
    await registrarAviso(A, "new-invoice", factura("12", "open", [5, 7]))
    await vaciarCola()
    const r = await registrarAviso(A, "edit-invoice", factura("12", "draft", [5, 7]))
    expect(r.accion).toBe("encolado")
    expect(await cola()).toEqual(["5", "7"])
    expect(await indice("invoice", "12")).toEqual(["5", "7"])

    // Ya es borrador: borrarla no devuelve nada.
    await vaciarCola()
    const borrado = await registrarAviso(A, "delete-invoice", factura("12", "draft", []))
    expect(borrado.accion).toBe("borrador")
    expect(await cola()).toEqual([])
  })

  it("edición a borrador de un documento sin historial: encola (pudo estar abierto)", async () => {
    const r = await registrarAviso(A, "edit-invoice", factura("13", "draft", [5]))
    expect(r.accion).toBe("encolado")
    expect(await cola()).toEqual(["5"])
  })

  it("borrar un borrador no encola nada", async () => {
    await registrarAviso(A, "new-invoice", factura("11", "draft", [5]))
    const r = await registrarAviso(A, "delete-invoice", factura("11", "draft", []))
    expect(r.accion).toBe("borrador")
    expect(await cola()).toEqual([])
    expect(await indice("invoice", "11")).toBeNull()
  })

  it("anulación (void) encola", async () => {
    await registrarAviso(A, "new-invoice", factura("10", "open", [5, 7]))
    await vaciarCola()
    await registrarAviso(A, "edit-invoice", factura("10", "void", [5]))
    expect(await cola()).toEqual(["5", "7"])
  })

  it("compra con un `state` desconocido encola igual", async () => {
    const r = await registrarAviso(A, "new-bill", compra("34", "algo-nuevo", [8]))
    expect(r.accion).toBe("encolado")
    expect(await cola()).toEqual(["8"])
  })

  it("avisos de ítems: encola el id", async () => {
    await registrarAviso(A, "edit-item", { message: { item: { id: 5, inventory: { availableQuantity: 40 } } } })
    await registrarAviso(A, "delete-item", { message: { item: { id: 6 } } })
    expect(await cola()).toEqual(["5", "6"])
  })

  it("re-encolar actualiza pedido_at y resetea intentos y error", async () => {
    await registrarAviso(A, "edit-item", { message: { item: { id: 5 } } })
    await getDb().execute(
      sql`UPDATE alegra_item_refresh SET pedido_at = now() - interval '1 hour', intentos = 3, ultimo_error = 'alegra_http_500'`,
    )
    await registrarAviso(A, "new-invoice", factura("10", "open", [5]))
    const [row] = await getDb().select().from(alegraItemRefresh)
    expect(row.intentos).toBe(0)
    expect(row.ultimoError).toBeNull()
    expect(row.motivo).toBe("new-invoice")
    expect(Date.now() - row.pedidoAt.getTime()).toBeLessThan(60_000)
  })

  it("verificación `{}`: sin_id, nada escrito", async () => {
    const r = await registrarAviso(A, "new-invoice", {})
    expect(r.accion).toBe("sin_id")
    expect(await cola()).toEqual([])
    expect(await getDb().select().from(alegraDocumentoItems)).toEqual([])
  })

  it("cuenta los avisos por día y evento", async () => {
    await registrarAviso(A, "new-invoice", factura("10", "open", [5]))
    await registrarAviso(A, "new-invoice", factura("12", "open", [6]))
    await registrarAviso(A, "edit-item", { message: { item: { id: 5 } } })
    const rows = await getDb().select().from(alegraWebhookAvisos).where(eq(alegraWebhookAvisos.tenantId, A))
    const porEvento = Object.fromEntries(rows.map((r) => [r.evento, r.cantidad]))
    expect(porEvento).toEqual({ "new-invoice": 2, "edit-item": 1 })
  })

  it("el índice no guarda datos del documento: sólo ids y estado", async () => {
    await registrarAviso(A, "new-bill", compra("33", "open", [8]))
    const filas = await getDb().execute(sql`SELECT row_to_json(d)::text AS t FROM alegra_documento_items d`)
    const texto = (filas as unknown as { t: string }[]).map((f) => f.t).join(" ")
    expect(texto).not.toContain("Proveedor Ejemplo")
  })
})

import { describe, expect, it } from "vitest"
import { EVENTOS_STOCK } from "./alegra"
import { esEventoStock, leerAvisoStock, rutaWebhookStock, tokenWebhookStock } from "./alegra-stock-webhook"
import { tokenWebhookContactos } from "./alegra-contacts-webhook"

// Lectura de los avisos de stock de Alegra. Fixtures INVENTADOS con la forma observada en la
// prueba real del 2026-09-24: `{"subject","message":{"invoice"|"bill"|"item":{...}}}`. El
// aviso sólo dice qué ítems re-leer: la salida nunca trae cliente, proveedor, montos ni
// cantidades.

const SECRETO = "s".repeat(40)

const cliente = { id: 900, name: "Cliente Ejemplo", identification: "20123456789", email: "a@cliente.example" }

const factura = (status: string, items: { id: number | string }[], extra: Record<string, unknown> = {}) => ({
  subject: "new-invoice",
  message: {
    invoice: {
      id: "10",
      status,
      client: cliente,
      total: 12345.67,
      items: items.map((it) => ({ ...it, name: "Lámpara", price: 1000, quantity: 2 })),
      ...extra,
    },
  },
})

describe("eventos, token y ruta", () => {
  it("acepta los 9 eventos y nada más", () => {
    expect(EVENTOS_STOCK.every(esEventoStock)).toBe(true)
    expect(esEventoStock("new-client")).toBe(false)
    expect(esEventoStock("void-invoice")).toBe(false)
  })

  it("el token de stock no es el de contactos", () => {
    const stock = tokenWebhookStock("tenant-a", SECRETO)
    expect(stock).toMatch(/^[0-9a-f]{32}$/)
    expect(stock).not.toBe(tokenWebhookContactos("tenant-a", SECRETO))
  })

  it("la ruta lleva tenant, evento y token", () => {
    expect(rutaWebhookStock("tenant-a", "edit-invoice", "tok")).toBe("/api/webhooks/alegra/stock/tenant-a/edit-invoice/tok")
  })
})

describe("leerAvisoStock", () => {
  it("factura abierta con ítems 5 y 7", () => {
    expect(leerAvisoStock("new-invoice", factura("open", [{ id: 5 }, { id: 7 }]))).toEqual({
      tipo: "invoice",
      docId: "10",
      estado: "open",
      itemIds: ["5", "7"],
    })
  })

  it("borrador y anulada: el estado viaja tal cual", () => {
    expect(leerAvisoStock("edit-invoice", factura("draft", [{ id: 5 }]))?.estado).toBe("draft")
    expect(leerAvisoStock("edit-invoice", factura("void", [{ id: 5 }]))?.estado).toBe("void")
  })

  it("edición que quitó un ítem: sólo los vigentes", () => {
    expect(leerAvisoStock("edit-invoice", factura("open", [{ id: 5 }]))?.itemIds).toEqual(["5"])
  })

  it("delete-invoice llega con items vacío", () => {
    expect(leerAvisoStock("delete-invoice", factura("open", []))).toEqual({
      tipo: "invoice",
      docId: "10",
      estado: "open",
      itemIds: [],
    })
  })

  it("compra: `state` en vez de `status`, proveedor en `client` que no aparece en la salida", () => {
    const bill = {
      subject: "new-bill",
      message: { bill: { id: 33, state: "open", client: cliente, warehouse: { id: 1 }, items: [{ id: 8, quantity: 4 }, { id: 9, quantity: 1 }] } },
    }
    const r = leerAvisoStock("new-bill", bill)
    expect(r).toEqual({ tipo: "bill", docId: "33", estado: "open", itemIds: ["8", "9"] })
    const texto = JSON.stringify(r)
    for (const dato of ["Cliente Ejemplo", "20123456789", "a@cliente.example", "900"]) expect(texto).not.toContain(dato)
  })

  it("new/edit/delete-item: el id del ítem, sin exponer availableQuantity", () => {
    const aviso = { subject: "edit-item", message: { item: { id: 5, name: "Lámpara", inventory: { availableQuantity: 40 } } } }
    for (const ev of ["new-item", "edit-item", "delete-item"] as const) {
      const r = leerAvisoStock(ev, aviso)
      expect(r).toEqual({ tipo: "item", docId: null, estado: null, itemIds: ["5"] })
      expect(JSON.stringify(r)).not.toContain("40")
    }
  })

  it("ids repetidos o raros se limpian", () => {
    expect(leerAvisoStock("new-invoice", factura("open", [{ id: 5 }, { id: "5" }, { id: "../x" }, { id: 7 }]))?.itemIds).toEqual(["5", "7"])
  })

  it("verificación `{}`, basura o cuerpo no JSON → null", () => {
    expect(leerAvisoStock("new-invoice", {})).toBeNull()
    expect(leerAvisoStock("new-invoice", null)).toBeNull()
    expect(leerAvisoStock("new-invoice", "no es json")).toBeNull()
    expect(leerAvisoStock("new-invoice", [1, 2])).toBeNull()
    expect(leerAvisoStock("new-item", { message: { item: { name: "sin id" } } })).toBeNull()
    expect(leerAvisoStock("new-invoice", { message: { invoice: { items: [{ id: 5 }] } } })).toBeNull()
  })

  it("documento en `data` o en la raíz, y como texto JSON", () => {
    const inv = { id: 10, status: "open", items: [{ id: 5 }] }
    const esperado = { tipo: "invoice", docId: "10", estado: "open", itemIds: ["5"] }
    expect(leerAvisoStock("new-invoice", { data: { invoice: inv } })).toEqual(esperado)
    expect(leerAvisoStock("new-invoice", { data: inv })).toEqual(esperado)
    expect(leerAvisoStock("new-invoice", inv)).toEqual(esperado)
    expect(leerAvisoStock("new-invoice", { message: JSON.stringify({ invoice: inv }) })).toEqual(esperado)
    expect(leerAvisoStock("edit-item", { item: { id: 5 } })).toEqual({ tipo: "item", docId: null, estado: null, itemIds: ["5"] })
  })
})

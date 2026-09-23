import { describe, expect, it, vi } from "vitest"
import type { TenantConfig } from "./tenants"

// El portal esconde los borradores de Alegra, pero el `total` de Alegra los cuenta:
// sin descontarlos, un cliente con un solo borrador veía "1–0 de 1" sobre una tabla vacía.

const state = vi.hoisted(() => ({ items: [] as Record<string, unknown>[], total: 0 }))

vi.mock("./alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./alegra")>()),
  listInvoicesPageByContact: async () => ({ items: state.items, total: state.total }),
}))

import { getFacturasPage } from "./erp"

const tenant = { id: "t", alegraMock: false } as unknown as TenantConfig
const factura = (id: string, status: string) => ({
  alegraId: id,
  date: "2026-09-01",
  dueDate: "2026-09-30",
  total: 1000,
  balance: 0,
  number: null,
  clientAlegraId: "42",
  status,
})

describe("getFacturasPage", () => {
  it("un solo borrador: sin facturas y total 0", async () => {
    state.items = [factura("1", "draft")]
    state.total = 1
    expect(await getFacturasPage(tenant, "42")).toEqual({ facturas: [], total: 0 })
  })

  it("descuenta del total los borradores escondidos en la ventana", async () => {
    state.items = [factura("1", "open"), factura("2", "draft"), factura("3", "closed")]
    state.total = 3
    const page = await getFacturasPage(tenant, "42")
    expect(page.facturas).toHaveLength(2)
    expect(page.total).toBe(2)
  })

  it("sin borradores el total es el de Alegra", async () => {
    state.items = [factura("1", "open")]
    state.total = 40
    expect((await getFacturasPage(tenant, "42")).total).toBe(40)
  })
})

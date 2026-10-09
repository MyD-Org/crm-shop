import { afterEach, describe, expect, it, vi } from "vitest"
import { createItem, ItemCampoObligatorioError } from "./alegra"
import type { TenantConfig } from "./tenants"

// createItem: alta de un ítem en la cuenta que factura cuando no lo tiene. Fetch falso.
// Caso real (MDP, 2026-10-08): la cuenta exige el campo adicional MARCA (422 code 1822) y el
// reintento sin `inventory` caía en "La unidad de medida es un campo obligatorio" (code 3140).

const tenant = { id: "t1", alegraMock: false, alegraEmail: "api@plataforma.example", alegraToken: "x" } as unknown as TenantConfig

const MARCA = { id: "cf-marca", name: "MARCA", status: "active", settings: { isRequired: true } }
const input = { name: "Contacto auxiliar", code: "NS2-AE11-CHINT", price: 100, taxId: "1", brand: "CHINT" }

function responde(...respuestas: Response[]) {
  const fetchMock = vi.fn(async () => respuestas.shift() ?? new Response("{}", { status: 500 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const bodyDe = (f: ReturnType<typeof responde>, i: number) =>
  JSON.parse(String(((f.mock.calls[i] as unknown[])[1] as RequestInit).body))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("createItem", () => {
  it("manda la marca en el campo adicional MARCA de la cuenta", async () => {
    const f = responde(Response.json([MARCA]), Response.json({ id: 77, name: "Contacto auxiliar" }))
    const creado = await createItem(tenant, input)
    expect(creado.alegraId).toBe("77")
    expect(new URL(String((f.mock.calls[0] as unknown[])[0])).pathname).toMatch(/\/custom-fields$/)
    expect(bodyDe(f, 1).customFields).toEqual([{ id: "cf-marca", value: "CHINT" }])
  })

  it("sin campo de marca en la cuenta, no manda customFields", async () => {
    const f = responde(Response.json([]), Response.json({ id: 78, name: "x" }))
    await createItem(tenant, input)
    expect(bodyDe(f, 1).customFields).toBeUndefined()
  })

  it("MARCA obligatoria y producto sin marca: corta antes del POST", async () => {
    const f = responde(Response.json([MARCA]))
    await expect(createItem(tenant, { ...input, brand: null })).rejects.toBeInstanceOf(ItemCampoObligatorioError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("otro campo obligatorio que no se sabe completar: corta antes del POST", async () => {
    const f = responde(Response.json([MARCA, { id: "cf-2", name: "Origen", status: "active", settings: { isRequired: true } }]))
    await expect(createItem(tenant, input)).rejects.toThrow(/Origen/)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("ignora campos obligatorios inactivos", async () => {
    const f = responde(
      Response.json([{ id: "cf-3", name: "Código de barras", status: "inactive", settings: { isRequired: true } }]),
      Response.json({ id: 79, name: "x" }),
    )
    await createItem(tenant, input)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("si el alta inventariable da 4xx, reintenta no inventariable CON unidad y registra el primer error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const f = responde(
      Response.json([]),
      Response.json({ message: "algo", code: 9999 }, { status: 400 }),
      Response.json({ id: 80, name: "x" }),
    )
    await createItem(tenant, input)
    expect(bodyDe(f, 1).inventory).toEqual({ unit: "unit", initialQuantity: 0, unitCost: 0 })
    expect(bodyDe(f, 2).inventory).toEqual({ unit: "unit" })
    expect(warn.mock.calls[0]?.[0]).toMatch(/alegra_item_inventariable_rechazado/)
  })
})

import { describe, expect, it } from "vitest"
import { mapRawContactRow } from "./alegra"

// Contacto crudo de Alegra → fila del espejo (tabla alegra_contacts). Datos inventados:
// CUITs de fantasía y casillas @cliente.example.

const crudo = (extra: Record<string, unknown> = {}) => ({ id: 42, name: "Iluminación Ejemplo SRL", status: "active", ...extra })

describe("mapRawContactRow — identificación", () => {
  it("string con guiones: crudo tal cual y normalizado a dígitos", () => {
    const f = mapRawContactRow(crudo({ identification: "20-12345678-9" }))
    expect(f.identification).toBe("20-12345678-9")
    expect(f.identificationNorm).toBe("20123456789")
  })

  it("objeto { type, number }: se aplana al número", () => {
    const f = mapRawContactRow(crudo({ identification: { type: "CUIT", number: "30-71234567-8" } }))
    expect(f.identification).toBe("30-71234567-8")
    expect(f.identificationNorm).toBe("30712345678")
  })

  it("vacío, sin dígitos o ausente → normalizado null", () => {
    expect(mapRawContactRow(crudo({ identification: "" })).identificationNorm).toBeNull()
    expect(mapRawContactRow(crudo({ identification: "s/n" })).identificationNorm).toBeNull()
    expect(mapRawContactRow(crudo({ identification: { type: "DNI" } })).identification).toBeNull()
    expect(mapRawContactRow(crudo()).identificationNorm).toBeNull()
  })
})

describe("mapRawContactRow — email con forma inesperada", () => {
  it("null u objeto → email null y sin casillas normalizadas (queda en raw)", () => {
    const deObjeto = mapRawContactRow(crudo({ email: { address: "x@cliente.example" } }))
    expect(deObjeto.email).toBeNull()
    expect(deObjeto.emailsNorm).toEqual([])
    expect(deObjeto.raw.email).toEqual({ address: "x@cliente.example" })
    expect(mapRawContactRow(crudo({ email: null })).emailsNorm).toEqual([])
  })

  it("varias casillas en el campo: crudo tal cual, normalizadas en minúscula y partidas", () => {
    const f = mapRawContactRow(crudo({ email: " A@Cliente.example; b@cliente.example, a@cliente.example " }))
    expect(f.email).toBe("A@Cliente.example; b@cliente.example, a@cliente.example")
    expect(f.emailsNorm).toEqual(["a@cliente.example", "b@cliente.example"])
  })
})

describe("mapRawContactRow — teléfonos", () => {
  it("normaliza los tres campos, sin vacíos ni repetidos", () => {
    const f = mapRawContactRow(
      crudo({ phonePrimary: "+54 9 11 5555-0001", phoneSecondary: "", mobile: "11 5555 0001" }),
    )
    expect(f.phonePrimary).toBe("+54 9 11 5555-0001")
    expect(f.phoneSecondary).toBeNull()
    expect(f.mobile).toBe("11 5555 0001")
    expect(f.phonesNorm).toEqual(["1155550001"])
  })

  it("teléfonos distintos quedan los dos; uno demasiado corto se descarta", () => {
    const f = mapRawContactRow(crudo({ phonePrimary: "0223 555-0112", mobile: "1234", phoneSecondary: "11 5555 0002" }))
    expect(f.phonesNorm).toEqual(["2235550112", "1155550002"])
  })
})

describe("mapRawContactRow — datos para tipo de cuenta", () => {
  it("term.days como string '30' → 30; '' → null", () => {
    expect(mapRawContactRow(crudo({ term: { id: 3, name: "30 días", days: "30" } })).paymentTermDays).toBe(30)
    expect(mapRawContactRow(crudo({ term: { id: 1, name: "De contado", days: "" } })).paymentTermDays).toBeNull()
    expect(mapRawContactRow(crudo()).paymentTermDays).toBeNull()
  })

  it("creditLimit vacío → null; número o string numérico → string", () => {
    expect(mapRawContactRow(crudo({ creditLimit: "" })).creditLimit).toBeNull()
    expect(mapRawContactRow(crudo({ creditLimit: null })).creditLimit).toBeNull()
    expect(mapRawContactRow(crudo({ creditLimit: 50000 })).creditLimit).toBe("50000")
    expect(mapRawContactRow(crudo({ creditLimit: "0" })).creditLimit).toBe("0")
  })
})

describe("mapRawContactRow — resto de los campos", () => {
  it("lista de precios, vendedor, plazo, tipos, estado y crudo completo", () => {
    const raw = crudo({
      id: 7,
      type: ["client", "provider"],
      priceList: { id: 2, name: "Mayorista", status: "active" },
      seller: { id: 5, name: "Vendedora Ejemplo" },
      term: { id: 3, name: "30 días", days: "30" },
      status: "inactive",
    })
    const f = mapRawContactRow(raw)
    expect(f).toMatchObject({
      alegraId: "7",
      name: "Iluminación Ejemplo SRL",
      types: ["client", "provider"],
      priceListId: "2",
      priceListName: "Mayorista",
      priceListStatus: "active",
      sellerId: "5",
      sellerName: "Vendedora Ejemplo",
      paymentTermId: "3",
      paymentTermName: "30 días",
      alegraStatus: "inactive",
    })
    expect(f.raw).toBe(raw)
  })

  it("type como string suelto → array de un elemento; ausente → []", () => {
    expect(mapRawContactRow(crudo({ type: "client" })).types).toEqual(["client"])
    expect(mapRawContactRow(crudo()).types).toEqual([])
  })

  it("sin lista, vendedor ni plazo → todo null", () => {
    const f = mapRawContactRow(crudo({ priceList: null }))
    expect(f.priceListId).toBeNull()
    expect(f.priceListStatus).toBeNull()
    expect(f.sellerId).toBeNull()
    expect(f.paymentTermId).toBeNull()
  })
})

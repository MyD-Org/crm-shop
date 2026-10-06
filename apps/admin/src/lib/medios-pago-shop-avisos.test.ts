import { describe, it, expect } from "vitest"
import { avisosDeMedio, type MedioParaAvisos } from "@/lib/medios-pago-shop-avisos"

const base: MedioParaAvisos = {
  nombre: "Transferencia",
  activo: true,
  listaOnlineId: null,
  listaOnlineNombre: null,
  listaOnlineActiva: false,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
}
const enlazada = { listaOnlineId: "l1", listaOnlineNombre: "Lista A", listaOnlineActiva: true }
const ctx = (caras: string[] = []) => ({ listasMasCaras: new Set(caras) })

describe("avisosDeMedio: cobro en línea", () => {
  it("payway activo avisa que depende de las credenciales de la tienda", () => {
    const a = avisosDeMedio({ ...base, slug: "payway", nombre: "Payway" }, ctx())
    expect(a).toHaveLength(1)
    expect(a[0]).toContain("Payway")
    expect(a[0]).toContain("credenciales")
  })

  it("payway inactivo no avisa", () => {
    expect(avisosDeMedio({ ...base, slug: "payway", activo: false }, ctx())).toEqual([])
  })

  it("un medio sin cobro en línea no avisa", () => {
    expect(avisosDeMedio({ ...base, slug: "transferencia" }, ctx())).toEqual([])
  })
})

describe("avisosDeMedio", () => {
  it("un medio sin nada configurado no avisa", () => {
    expect(avisosDeMedio(base, ctx())).toEqual([])
  })

  it("lista desactivada: avisa con el nombre y que rige la referencia", () => {
    const a = avisosDeMedio({ ...base, ...enlazada, listaOnlineActiva: false }, ctx())
    expect(a).toHaveLength(1)
    expect(a[0]).toContain("Lista A")
    expect(a[0]).toContain("desactivada")
    expect(a[0]).toContain("referencia")
  })

  it("lista en general más cara que la de referencia: avisa y no bloquea", () => {
    const a = avisosDeMedio({ ...base, ...enlazada }, ctx(["l1"]))
    expect(a).toHaveLength(1)
    expect(a[0]).toContain("Lista A")
    expect(a[0]).toContain("más cara")
  })

  it("destacado sin lista: no mostrará el precio con el medio", () => {
    const a = avisosDeMedio({ ...base, destacarEnCatalogo: true }, ctx())
    expect(a).toEqual(['No se mostrará "con Transferencia" en el catálogo: el medio no tiene una lista de precios enlazada.'])
  })

  it("ficha sin lista: no aparecerá en la ficha", () => {
    const a = avisosDeMedio({ ...base, mostrarEnFicha: true }, ctx())
    expect(a).toEqual(["No aparecerá en la ficha del producto: el medio no tiene una lista de precios enlazada."])
  })

  it("destacado y ficha con el medio inactivo avisan por ambos", () => {
    const a = avisosDeMedio({ ...base, ...enlazada, activo: false, destacarEnCatalogo: true, mostrarEnFicha: true }, ctx())
    expect(a).toEqual([
      'No se mostrará "con Transferencia" en el catálogo: el medio está inactivo.',
      "No aparecerá en la ficha del producto: el medio está inactivo.",
    ])
  })

  it("lista desactivada con destacado: avisa de la lista y de que no se mostrará", () => {
    const a = avisosDeMedio({ ...base, ...enlazada, listaOnlineActiva: false, destacarEnCatalogo: true }, ctx())
    expect(a).toHaveLength(2)
  })
})

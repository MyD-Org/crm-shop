import { describe, it, expect } from "vitest"
import { avisosDeMedio, type MedioParaAvisos } from "@/lib/medios-pago-shop-avisos"

const base: MedioParaAvisos = {
  nombre: "Transferencia",
  activo: true,
  idListaPrecios: null,
  listaPreciosNombre: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
}
const ctx = (ids: string[], caras: string[] = []) => ({ listasExistentes: new Set(ids), listasMasCaras: new Set(caras) })

describe("avisosDeMedio", () => {
  it("un medio sin nada configurado no avisa", () => {
    expect(avisosDeMedio(base, ctx(["3"]))).toEqual([])
  })

  it("lista dada de baja: avisa con el nombre guardado", () => {
    const a = avisosDeMedio({ ...base, idListaPrecios: "9", listaPreciosNombre: "Lista vieja" }, ctx(["3"]))
    expect(a).toHaveLength(1)
    expect(a[0]).toContain("Lista vieja")
    expect(a[0]).toContain("ya no existe")
  })

  it("lista en general más cara que la por defecto: avisa y no bloquea", () => {
    const a = avisosDeMedio({ ...base, idListaPrecios: "3", listaPreciosNombre: "Lista cara" }, ctx(["3"], ["3"]))
    expect(a).toHaveLength(1)
    expect(a[0]).toContain("Lista cara")
    expect(a[0]).toContain("más cara")
  })

  it("destacado sin lista: no mostrará el precio con el medio", () => {
    const a = avisosDeMedio({ ...base, destacarEnCatalogo: true }, ctx([]))
    expect(a).toEqual(['No se mostrará "con Transferencia" en el catálogo: el medio no tiene una lista de precios enlazada.'])
  })

  it("ficha sin lista: no aparecerá en la ficha", () => {
    const a = avisosDeMedio({ ...base, mostrarEnFicha: true }, ctx([]))
    expect(a).toEqual(["No aparecerá en la ficha del producto: el medio no tiene una lista de precios enlazada."])
  })

  it("destacado y ficha con el medio inactivo avisan por ambos", () => {
    const a = avisosDeMedio(
      { ...base, activo: false, idListaPrecios: "3", listaPreciosNombre: "L", destacarEnCatalogo: true, mostrarEnFicha: true },
      ctx(["3"]),
    )
    expect(a).toEqual([
      'No se mostrará "con Transferencia" en el catálogo: el medio está inactivo.',
      "No aparecerá en la ficha del producto: el medio está inactivo.",
    ])
  })

  it("lista huérfana con destacado: avisa de la baja y de que no se mostrará", () => {
    const a = avisosDeMedio({ ...base, idListaPrecios: "9", listaPreciosNombre: "Vieja", destacarEnCatalogo: true }, ctx(["3"]))
    expect(a).toHaveLength(2)
  })
})

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

describe("avisosDeMedio: medio solo para cuentas corrientes", () => {
  const cc = { ...base, audiencia: "cuenta_corriente" as const }

  it("activo y sin lista: sin avisos", () => {
    expect(avisosDeMedio(cc, ctx())).toEqual([])
  })

  it("inactivo: avisa que los pedidos de cuenta corriente quedarán a coordinar", () => {
    const a = avisosDeMedio({ ...cc, activo: false }, ctx())
    expect(a).toEqual(["Con este medio inactivo, los pedidos de las cuentas corrientes quedarán a coordinar."])
  })

  it("con lista enlazada: avisa que no se usa", () => {
    const a = avisosDeMedio({ ...cc, ...enlazada }, ctx())
    expect(a).toEqual(["Este medio es solo para cuentas corrientes: la lista enlazada no se usa."])
  })
})

describe("avisosDeMedio: cuotas sin interés vs Mercado Pago", () => {
  const mp: MedioParaAvisos = {
    ...base,
    slug: "mercadopago",
    nombre: "Mercado Pago",
    condicionesCuotas: [{ cuotas: 3 }, { cuotas: 6 }],
  }
  const cuenta = (marcas: { nombre: string; cuotasConInteres: number[] }[], cuentaId = "principal") => ({
    cuentaId,
    marcas: marcas.map((m) => ({ nombre: m.nombre, cuotasConInteres: new Set(m.cuotasConInteres) })),
  })
  const conInteres = (...cuentas: ReturnType<typeof cuenta>[]) => ({ listasMasCaras: new Set<string>(), interesMP: cuentas })

  it("avisa qué cantidad tiene interés en qué marca", () => {
    const a = avisosDeMedio(mp, conInteres(cuenta([{ nombre: "Naranja", cuotasConInteres: [6] }, { nombre: "Visa", cuotasConInteres: [] }])))
    expect(a).toEqual([
      "En Mercado Pago, 6 cuotas tienen interés con Naranja. Márquelas sin interés en el panel de Mercado Pago o el cliente pagará interés encima.",
    ])
  })

  it("agrupa las cantidades que afectan a las mismas marcas", () => {
    const a = avisosDeMedio(
      mp,
      conInteres(
        cuenta([
          { nombre: "Visa", cuotasConInteres: [3, 6] },
          { nombre: "Mastercard", cuotasConInteres: [3, 6] },
          { nombre: "Naranja", cuotasConInteres: [6] },
        ]),
      ),
    )
    expect(a).toHaveLength(2)
    expect(a[0]).toContain("3 cuotas tienen interés con Visa y Mastercard.")
    expect(a[1]).toContain("6 cuotas tienen interés con Visa, Mastercard y Naranja.")
  })

  it("ignora las cantidades que la tienda no ofrece sin interés", () => {
    const a = avisosDeMedio(mp, conInteres(cuenta([{ nombre: "Visa", cuotasConInteres: [12, 18] }])))
    expect(a).toEqual([])
  })

  it("tasa 0 (sin cantidades con interés) => sin aviso", () => {
    expect(avisosDeMedio(mp, conInteres(cuenta([{ nombre: "Visa", cuotasConInteres: [] }])))).toEqual([])
  })

  it("sin consulta (clave ausente o MP caído) => sin aviso", () => {
    expect(avisosDeMedio(mp, ctx())).toEqual([])
    expect(avisosDeMedio(mp, conInteres())).toEqual([])
  })

  it("un medio sin cuotas sin interés o inactivo no avisa", () => {
    const hay = conInteres(cuenta([{ nombre: "Visa", cuotasConInteres: [6] }]))
    expect(avisosDeMedio({ ...mp, condicionesCuotas: [] }, hay)).toEqual([])
    expect(avisosDeMedio({ ...mp, activo: false }, hay)).toEqual([])
  })

  it("otro medio (aunque tenga cuotas) no recibe el aviso de Mercado Pago", () => {
    const hay = conInteres(cuenta([{ nombre: "Visa", cuotasConInteres: [6] }]))
    expect(avisosDeMedio({ ...mp, slug: "payway" }, hay).some((x) => x.includes("Mercado Pago"))).toBe(false)
  })

  it("con varias cuentas dice a cuál se refiere", () => {
    const a = avisosDeMedio(
      mp,
      conInteres(
        cuenta([{ nombre: "Visa", cuotasConInteres: [6] }], "mdp"),
        cuenta([{ nombre: "Visa", cuotasConInteres: [6] }], "igz"),
      ),
    )
    expect(a).toHaveLength(2)
    expect(a[0]).toContain("En la cuenta «mdp» de Mercado Pago, 6 cuotas tienen interés con Visa.")
    expect(a[1]).toContain("En la cuenta «igz» de Mercado Pago")
  })

  it("el texto está en usted", () => {
    const [a] = avisosDeMedio(mp, conInteres(cuenta([{ nombre: "Visa", cuotasConInteres: [6] }])))
    expect(a).toMatch(/Márquelas/)
    expect(a).not.toMatch(/\b(tu|tus|te|vos|marcalas)\b/i)
  })
})

describe("avisosDeMedio: cantidades con las mismas marcas", () => {
  it("3 y 6 cuotas con interés en las mismas marcas van en un solo aviso", () => {
    const mp: MedioParaAvisos = { ...base, slug: "mercadopago", condicionesCuotas: [{ cuotas: 3 }, { cuotas: 6 }, { cuotas: 12 }] }
    const interesMP = [{ cuentaId: "principal", marcas: [{ nombre: "Visa", cuotasConInteres: new Set([3, 6]) }] }]
    const a = avisosDeMedio(mp, { listasMasCaras: new Set(), interesMP })
    expect(a).toHaveLength(1)
    expect(a[0]).toContain("3 y 6 cuotas tienen interés con Visa.")
  })
})

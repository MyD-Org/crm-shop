import { describe, expect, it } from "vitest"
import {
  OPCIONES_HORAS,
  nombreCliente,
  queryCarritos,
  resumenProductos,
  textoInactividad,
  ROTULO_MONTO,
  NOTA_SESION,
} from "./logica"

describe("queryCarritos", () => {
  it("siempre manda inactividad y antigüedad; el filtro de pedido en 'todos' se omite", () => {
    expect(queryCarritos({ start: 0, limit: 25 })).toBe("horas=1&dias=30&start=0&limit=25")
    expect(queryCarritos({ horas: 24, dias: 90, pedido: "sin_pedido", q: "  ana ", start: 25, limit: 25 })).toBe(
      "horas=24&dias=90&pedido=sin_pedido&q=ana&start=25&limit=25",
    )
    expect(queryCarritos({ pedido: "todos", start: -2, limit: 10 })).toBe("horas=1&dias=30&start=0&limit=10")
  })

  it("las opciones de inactividad coinciden con las del servidor (mínimo 1 hora)", () => {
    expect(OPCIONES_HORAS.map((o) => o.value)).toEqual(["1", "6", "24", "72"])
  })
})

describe("textoInactividad", () => {
  it("horas y días", () => {
    expect(textoInactividad(0.4)).toBe("menos de 1 hora")
    expect(textoInactividad(1)).toBe("1 hora")
    expect(textoInactividad(5.9)).toBe("5 horas")
    expect(textoInactividad(47)).toBe("47 horas")
    expect(textoInactividad(72)).toBe("3 días")
    expect(textoInactividad(Number.NaN)).toBe("menos de 1 hora")
  })
})

describe("nombreCliente / resumenProductos", () => {
  it("nombre, si no email, si no un rótulo", () => {
    expect(nombreCliente({ nombre: "Ana Pérez", email: "a@cliente.example" })).toBe("Ana Pérez")
    expect(nombreCliente({ nombre: " ", email: "a@cliente.example" })).toBe("a@cliente.example")
    expect(nombreCliente({ nombre: null, email: null })).toBe("Cliente sin nombre")
  })

  it("lista cantidad x nombre y suma 'y N más' si hay más líneas que las traídas", () => {
    expect(
      resumenProductos([{ nombre: "Lámpara", brand: null, qty: 2 }, { nombre: null, brand: null, qty: 1 }], 2),
    ).toEqual(["2 × Lámpara", "1 × Producto no disponible"])
    expect(resumenProductos([{ nombre: "A", brand: null, qty: 1 }], 4)).toEqual(["1 × A", "y 3 más"])
  })
})

describe("textos fijos en usted", () => {
  it("rotula el monto como referencial y aclara que son compradores con sesión", () => {
    expect(ROTULO_MONTO).toBe("Monto referencial (precio de lista; puede diferir del que verá en el pago)")
    expect(NOTA_SESION).toBe("Solo se muestran compradores con sesión iniciada.")
  })
})

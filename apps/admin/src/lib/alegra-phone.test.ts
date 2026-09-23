import { describe, it, expect } from "vitest"
import { esCliente, normalizePhone } from "./alegra"

// La búsqueda por teléfono vive en el espejo (buscarPorTelefono en lib/contactos.ts, probada
// en test/integration/contactos-fachada.integration.test.ts). Acá quedan las dos piezas puras
// que usa: la normalización del número y el filtro de cuentas internas.

describe("normalizePhone", () => {
  it("empareja los formatos en que llega el mismo número", () => {
    // wa_id (sin '+'), Alegra, y carga a mano con 0 y con espacios.
    const wa = normalizePhone("5492235550112")
    expect(normalizePhone("+5492235550112")).toBe(wa)
    expect(normalizePhone("+54 9 223 555-0112")).toBe(wa)
    expect(normalizePhone("02235550112")).toBe(wa)
    expect(normalizePhone("223 555 0112")).toBe(wa)
  })

  it("no confunde números distintos", () => {
    expect(normalizePhone("+5492235550112")).not.toBe(normalizePhone("+5492235903025"))
  })

  it("normaliza los formatos que ya están cargados en esta cuenta de Alegra", () => {
    expect(normalizePhone(" 011 4574-3077")).toBe("1145743077")
    expect(normalizePhone("223 4959686")).toBe("2234959686")
    expect(normalizePhone("+54 (11) 4707-0184 ")).toBe("1147070184")
  })

  it("trata como ausente lo que no identifica una línea", () => {
    expect(normalizePhone("")).toBe("")
    expect(normalizePhone(null)).toBe("")
    expect(normalizePhone(undefined)).toBe("")
    expect(normalizePhone("1234567")).toBe("") // 7 dígitos: matchearía de más
    expect(normalizePhone("no tengo")).toBe("")
  })
})

describe("cuentas internas (esCliente)", () => {
  it("no toma como cliente una cuenta interna o un marcador", () => {
    // Si "Stock general" tiene cargado el mismo número que un cliente, un match automático
    // le colgaría el pedido a la cuenta interna.
    expect(esCliente("Stock general")).toBe(false)
    expect(esCliente(" STOCK TALLER ")).toBe(false)
    expect(esCliente("POS")).toBe(false)
    expect(esCliente("Cliente viejo - NO USAR")).toBe(false)
    expect(esCliente("")).toBe(false)
  })

  it("un cliente común sí", () => {
    expect(esCliente("Constructora Delta SA")).toBe(true)
    expect(esCliente("Ferretería El Tornillo")).toBe(true)
  })
})

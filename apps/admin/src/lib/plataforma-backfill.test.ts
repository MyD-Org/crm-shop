import { describe, it, expect } from "vitest"
import { pasadasPorFuente } from "./plataforma-backfill"

describe("pasadasPorFuente", () => {
  it("una pasada por (producto, fuente), en orden nombre → pdf → manual", () => {
    const filas = [
      { alegraId: "42", clave: "potencia_w", valorNum: 20, valorTexto: null, fuente: "manual" },
      { alegraId: "42", clave: "ip", valorNum: 65, valorTexto: null, fuente: "pdf" },
      { alegraId: "42", clave: "tono", valorNum: null, valorTexto: "calido", fuente: "nombre" },
      { alegraId: "43", clave: "ip", valorNum: 20, valorTexto: null, fuente: "nombre" },
    ]
    expect(pasadasPorFuente(filas)).toEqual([
      { fuente: "nombre", alegraId: "42", data: { tono: { n: null, t: "calido" } }, reemplaza: true },
      { fuente: "nombre", alegraId: "43", data: { ip: { n: 20, t: null } }, reemplaza: true },
      { fuente: "pdf", alegraId: "42", data: { ip: { n: 65, t: null } }, reemplaza: false },
      { fuente: "manual", alegraId: "42", data: { potencia_w: { n: 20, t: null } }, reemplaza: false },
    ])
  })

  it("convierte valorNum textual (numeric de Postgres) a número y no mezcla claves de distintas fuentes", () => {
    const pasadas = pasadasPorFuente([
      { alegraId: "7", clave: "potencia_w", valorNum: "20.50", valorTexto: null, fuente: "nombre" },
      { alegraId: "7", clave: "tension_v", valorNum: "220", valorTexto: "85-265", fuente: "nombre" },
    ])
    expect(pasadas).toEqual([
      { fuente: "nombre", alegraId: "7", data: { potencia_w: { n: 20.5, t: null }, tension_v: { n: 220, t: "85-265" } }, reemplaza: true },
    ])
  })

  it("un producto sin filas de nombre igual entra en la pasada nombre con data {} (para converger); pdf/manual no reemplazan", () => {
    const pasadas = pasadasPorFuente([
      { alegraId: "8", clave: "ip", valorNum: 65, valorTexto: null, fuente: "pdf" },
      { alegraId: "9", clave: "potencia_w", valorNum: 5, valorTexto: null, fuente: "manual" },
    ])
    expect(pasadas).toEqual([
      { fuente: "nombre", alegraId: "8", data: {}, reemplaza: true },
      { fuente: "nombre", alegraId: "9", data: {}, reemplaza: true },
      { fuente: "pdf", alegraId: "8", data: { ip: { n: 65, t: null } }, reemplaza: false },
      { fuente: "manual", alegraId: "9", data: { potencia_w: { n: 5, t: null } }, reemplaza: false },
    ])
  })

  it("sin filas devuelve sin pasadas", () => {
    expect(pasadasPorFuente([])).toEqual([])
  })
})

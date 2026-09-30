import { beforeEach, describe, expect, it } from "vitest"
import { MAX_LECTURAS_POR_MINUTO, reiniciarGuardaLectura, tomarLectura } from "./catalogo-atributos-lectura-guarda"

beforeEach(() => reiniciarGuardaLectura())

describe("guarda de la lectura de fichas", () => {
  it("una sola lectura en curso por producto; se libera al terminar", () => {
    const a = tomarLectura("t", "1", 0)
    expect(a.ok).toBe(true)
    expect(tomarLectura("t", "1", 1)).toEqual({ ok: false, motivo: "en_curso" })
    // Otro producto u otro tenant no se bloquean.
    expect(tomarLectura("t", "2", 1).ok).toBe(true)
    expect(tomarLectura("otro", "1", 1).ok).toBe(true)
    if (a.ok) a.liberar()
    expect(tomarLectura("t", "1", 2).ok).toBe(true)
  })

  it(`tope de ${MAX_LECTURAS_POR_MINUTO} por minuto y por tenant; la ventana siguiente vuelve a abrir`, () => {
    for (let i = 0; i < MAX_LECTURAS_POR_MINUTO; i++) {
      const p = tomarLectura("t", String(i), 1000)
      expect(p.ok).toBe(true)
      if (p.ok) p.liberar()
    }
    expect(tomarLectura("t", "x", 2000)).toEqual({ ok: false, motivo: "limite" })
    expect(tomarLectura("otro", "x", 2000).ok).toBe(true)
    expect(tomarLectura("t", "x", 1000 + 60_000).ok).toBe(true)
  })

  it("un rechazo no consume uso ni deja nada en curso", () => {
    const a = tomarLectura("t", "1", 0)
    expect(tomarLectura("t", "1", 0).ok).toBe(false)
    if (a.ok) a.liberar()
    // liberar dos veces no rompe nada
    if (a.ok) a.liberar()
    expect(tomarLectura("t", "1", 0).ok).toBe(true)
  })
})

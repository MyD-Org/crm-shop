import { describe, expect, it, vi } from "vitest"
import {
  ErrorLecturaFicha,
  HERRAMIENTA_ATRIBUTOS,
  MODELO_FICHA,
  estimarCostoLote,
  interpretarRespuesta,
  leerFichaPdf,
  pedidoLecturaFicha,
} from "./catalogo-atributos-pdf"
import { CLAVES_ATRIBUTO } from "./catalogo-atributos-extraccion"

// El cliente de Anthropic está SIMULADO (fetch inyectado): ningún test sale a la red.

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // "%PDF"

function respuestaOk(input: unknown) {
  return {
    id: "msg_test",
    type: "message",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "toolu_1", name: "registrar_atributos", input }],
    usage: { input_tokens: 4200, output_tokens: 120 },
  }
}

describe("pedidoLecturaFicha", () => {
  it("manda el PDF en base64 como document, a Haiku, con la herramienta forzada", () => {
    const p = pedidoLecturaFicha(PDF, "REFLECTOR LED 50W")
    expect(p.model).toBe(MODELO_FICHA)
    expect(MODELO_FICHA).toBe("claude-haiku-4-5")
    expect(p.tool_choice).toEqual({ type: "tool", name: "registrar_atributos" })
    const [doc, texto] = p.messages[0].content
    expect(doc).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERg==" } })
    expect(texto).toEqual({ type: "text", text: "Producto: REFLECTOR LED 50W" })
  })

  it("el esquema de salida es cerrado y tiene exactamente las claves de catalog_atributos", () => {
    const s = HERRAMIENTA_ATRIBUTOS.input_schema
    expect(s.additionalProperties).toBe(false)
    expect(Object.keys(s.properties).sort()).toEqual([...CLAVES_ATRIBUTO].sort())
    expect([...s.required].sort()).toEqual([...CLAVES_ATRIBUTO].sort())
  })
})

describe("interpretarRespuesta", () => {
  it("normaliza la salida: descarta null, claves de más y valores imposibles", () => {
    const r = interpretarRespuesta(
      respuestaOk({ potencia_w: 50, temperatura_k: 3000, tono: null, ip: 65, flujo_lm: null, tension_v: "85-265", zocalo: null, extra: 1, }),
    )
    expect(r.uso).toEqual({ entrada: 4200, salida: 120 })
    expect(r.atributos).toEqual([
      { clave: "potencia_w", valorNum: 50, valorTexto: null },
      { clave: "temperatura_k", valorNum: 3000, valorTexto: null },
      { clave: "tono", valorNum: null, valorTexto: "calido" },
      { clave: "ip", valorNum: 65, valorTexto: null },
      { clave: "tension_v", valorNum: 220, valorTexto: "85-265" },
    ])
  })

  it("sin tool_use (p. ej. refusal o max_tokens) tira ErrorLecturaFicha", () => {
    expect(() => interpretarRespuesta({ stop_reason: "end_turn", content: [{ type: "text", text: "no" }] })).toThrow(ErrorLecturaFicha)
    expect(() => interpretarRespuesta(null)).toThrow(ErrorLecturaFicha)
  })
})

describe("leerFichaPdf (fetch simulado)", () => {
  it("llama a la Messages API con la clave y la versión, y devuelve los atributos", async () => {
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify(respuestaOk({ potencia_w: 12, zocalo: "E27" })), { status: 200 }))
    const r = await leerFichaPdf(PDF, "LAMPARA", { fetch: fetchFalso as unknown as typeof fetch, apiKey: "clave-de-prueba" })
    expect(r.atributos.map((a) => a.clave)).toEqual(["potencia_w", "zocalo"])
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.anthropic.com/v1/messages")
    expect(init.headers).toMatchObject({ "x-api-key": "clave-de-prueba", "anthropic-version": "2023-06-01" })
    expect(JSON.parse(String(init.body)).model).toBe("claude-haiku-4-5")
  })

  it("sin clave → 503 sin llamar a la API", async () => {
    const fetchFalso = vi.fn()
    await expect(leerFichaPdf(PDF, "X", { fetch: fetchFalso as unknown as typeof fetch, apiKey: " " })).rejects.toMatchObject({ estado: 503 })
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it("error de la API → ErrorLecturaFicha con mensaje para el operador, sin el cuerpo del error", async () => {
    const fetchFalso = vi.fn(async () => new Response('{"error":{"message":"detalle interno"}}', { status: 529 }))
    const err = await leerFichaPdf(PDF, "X", { fetch: fetchFalso as unknown as typeof fetch, apiKey: "k" }).catch((e) => e)
    expect(err).toBeInstanceOf(ErrorLecturaFicha)
    expect(err.paraUsuario).toMatch(/Inténtelo de nuevo/)
    expect(err.paraUsuario).not.toMatch(/detalle interno/)
  })

  it("falla de red → ErrorLecturaFicha", async () => {
    const fetchFalso = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })
    await expect(leerFichaPdf(PDF, "X", { fetch: fetchFalso as unknown as typeof fetch, apiKey: "k" })).rejects.toBeInstanceOf(ErrorLecturaFicha)
  })
})

describe("estimarCostoLote", () => {
  it("1.300 fichas de 2 páginas en Haiku 4.5 ($1 / $5 por MTok): pocos dólares", () => {
    const e = estimarCostoLote(1300, 2)
    expect(e.tokensEntrada).toBe(1300 * (2 * 3000 + 600))
    expect(e.tokensSalida).toBe(1300 * 300)
    expect(e.usd).toBeCloseTo(8.58 + 1.95, 2)
  })
})

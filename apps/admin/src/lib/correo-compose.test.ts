import { describe, expect, it } from "vitest"
import {
  armarEnvio,
  asuntoReenviar,
  asuntoResponder,
  destinatariosPorDefecto,
  direccionDe,
  extensionBloqueada,
  textoAHtml,
  type MensajeOriginal,
} from "@/lib/correo-compose"

// Datos inventados con dominios .example.
const casilla = { nombre: "Ventas Cliente", email: "ventas@cliente.example" }
const original: MensajeOriginal = {
  direccion: "inbound",
  de: "Ana Prueba <ana@clientes.example>",
  para: ["ventas@cliente.example", "Otro <otro@cliente.example>"],
  cc: ["copia@clientes.example"],
  replyTo: [],
  asunto: "Consulta de precios",
  messageId: "<abc123@clientes.example>",
  recibidoEn: "2026-09-30T15:00:00.000Z",
  texto: "Hola, necesito precios.",
}
const MB = 1024 * 1024

describe("asunto", () => {
  it("Re: sin duplicar (Re, RE, Rv)", () => {
    expect(asuntoResponder("Consulta")).toBe("Re: Consulta")
    expect(asuntoResponder("Re: Consulta")).toBe("Re: Consulta")
    expect(asuntoResponder("RE:   Consulta")).toBe("RE:   Consulta")
    expect(asuntoResponder("RV: Consulta")).toBe("RV: Consulta")
    expect(asuntoResponder("")).toBe("Re: (sin asunto)")
  })
  it("Fwd: sin duplicar", () => {
    expect(asuntoReenviar("Consulta")).toBe("Fwd: Consulta")
    expect(asuntoReenviar("Fwd: Consulta")).toBe("Fwd: Consulta")
    expect(asuntoReenviar("RV: Consulta")).toBe("RV: Consulta")
  })
})

describe("direccionDe", () => {
  it("extrae la dirección y la baja a minúsculas", () => {
    expect(direccionDe("Ana Prueba <Ana@Clientes.Example>")).toBe("ana@clientes.example")
    expect(direccionDe(" x@y.example ")).toBe("x@y.example")
  })
})

describe("destinatariosPorDefecto", () => {
  it("responder: el remitente", () => {
    expect(destinatariosPorDefecto("responder", original, casilla.email)).toEqual({ para: ["ana@clientes.example"], cc: [] })
  })
  it("responder: reply_to si lo tiene", () => {
    const o = { ...original, replyTo: ["Respuestas <respuestas@clientes.example>"] }
    expect(destinatariosPorDefecto("responder", o, casilla.email).para).toEqual(["respuestas@clientes.example"])
  })
  it("responder a un saliente: sus destinatarios", () => {
    const o: MensajeOriginal = { ...original, direccion: "outbound", de: "Ventas Cliente <ventas@cliente.example>", para: ["ana@clientes.example"] }
    expect(destinatariosPorDefecto("responder", o, casilla.email).para).toEqual(["ana@clientes.example"])
  })
  it("responder a todos: remitente + to, cc original, sin la propia casilla ni duplicados", () => {
    const o = { ...original, cc: ["Copia@clientes.example", "ANA@clientes.example", "ventas@CLIENTE.example"] }
    const r = destinatariosPorDefecto("responderATodos", o, casilla.email)
    expect(r.para).toEqual(["ana@clientes.example", "otro@cliente.example"])
    expect(r.cc).toEqual(["copia@clientes.example"])
  })
  it("responder a todos: máximo 50 destinatarios", () => {
    const o = { ...original, para: Array.from({ length: 80 }, (_, i) => `u${i}@x.example`), cc: [] }
    const r = destinatariosPorDefecto("responderATodos", o, casilla.email)
    expect(r.para.length + r.cc.length).toBe(50)
  })
  it("reenviar y nuevo: vacío", () => {
    expect(destinatariosPorDefecto("reenviar", original, casilla.email)).toEqual({ para: [], cc: [] })
    expect(destinatariosPorDefecto("nuevo", undefined, casilla.email)).toEqual({ para: [], cc: [] })
  })
})

const base = { casilla, para: ["ana@clientes.example"], cc: [], cco: [], texto: "Gracias", adjuntosNuevos: [], adjuntosReenvio: [] }

describe("armarEnvio", () => {
  it("responder: from de la casilla, Re:, In-Reply-To y References", () => {
    const r = armarEnvio({ ...base, modo: "responder", original, asunto: asuntoResponder(original.asunto) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.from).toBe("Ventas Cliente <ventas@cliente.example>")
    expect(r.payload.subject).toBe("Re: Consulta de precios")
    expect(r.payload.headers).toEqual({ "In-Reply-To": "<abc123@clientes.example>", References: "<abc123@clientes.example>" })
    expect(r.aviso).toBeUndefined()
  })
  it("responder sin message_id: sin headers y con aviso", () => {
    const r = armarEnvio({ ...base, modo: "responder", original: { ...original, messageId: null }, asunto: "Re: x" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.headers).toBeUndefined()
    expect(r.aviso).toBe("La respuesta podría no agruparse en la conversación.")
  })
  it("cita el original en el texto y escapa el html", () => {
    const r = armarEnvio({ ...base, modo: "responder", original, asunto: "Re: x", texto: "a <b> & c" })
    if (!r.ok) throw new Error("debía ser ok")
    expect(r.payload.html).toContain("a &lt;b&gt; &amp; c")
    expect(r.payload.text).toContain("> Hola, necesito precios.")
    expect(r.payload.html).not.toContain("<b>")
  })
  it("reenviar: Fwd:, sin In-Reply-To, cabecera de cita y adjuntos originales", () => {
    const r = armarEnvio({
      ...base,
      modo: "reenviar",
      original,
      asunto: asuntoReenviar(original.asunto),
      adjuntosReenvio: [{ nombre: "lista.pdf", tamano: 1000, url: "https://descargas.resend.example/a?sig=1" }],
    })
    if (!r.ok) throw new Error("debía ser ok")
    expect(r.payload.subject).toBe("Fwd: Consulta de precios")
    expect(r.payload.headers).toBeUndefined()
    expect(r.payload.text).toContain("---------- Mensaje reenviado ----------")
    expect(r.payload.text).toContain("De: Ana Prueba <ana@clientes.example>")
    expect(r.payload.text).toContain("Asunto: Consulta de precios")
    expect(r.payload.attachments).toEqual([{ filename: "lista.pdf", path: "https://descargas.resend.example/a?sig=1" }])
  })
  it("nuevo: sin headers; cc y cco pasan", () => {
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "Hola", cc: ["c@x.example"], cco: ["o@x.example"] })
    if (!r.ok) throw new Error("debía ser ok")
    expect(r.payload.headers).toBeUndefined()
    expect(r.payload.cc).toEqual(["c@x.example"])
    expect(r.payload.bcc).toEqual(["o@x.example"])
    expect(r.payload.attachments).toBeUndefined()
  })
  it("dirección inválida", () => {
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "x", para: ["no-es-un-mail"] })
    expect(r).toEqual({ ok: false, error: "Revise las direcciones de correo ingresadas." })
  })
  it("sin destinatarios", () => {
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "x", para: [] })
    expect(r).toEqual({ ok: false, error: "Indique al menos un destinatario." })
  })
  it("más de 50 destinatarios", () => {
    const para = Array.from({ length: 51 }, (_, i) => `u${i}@x.example`)
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "x", para })
    expect(r).toEqual({ ok: false, error: "No puede enviar a más de 50 destinatarios." })
  })
  it("dedupe de destinatarios case-insensitive entre campos", () => {
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "x", para: ["A@x.example", "a@x.example"], cc: ["a@X.example", "b@x.example"] })
    if (!r.ok) throw new Error("debía ser ok")
    expect(r.payload.to).toEqual(["a@x.example"])
    expect(r.payload.cc).toEqual(["b@x.example"])
  })
  it("tope de 40 MB contando el 37 % del base64", () => {
    const grande = { nombre: "a.zip", tamano: 30 * MB, url: "https://r2.example/a" }
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "x", adjuntosNuevos: [grande] })
    expect(r).toEqual({ ok: false, error: "Los adjuntos superan el máximo de 40 MB." })
    const ok = armarEnvio({ ...base, modo: "nuevo", asunto: "x", adjuntosNuevos: [{ ...grande, tamano: 25 * MB }] })
    expect(ok.ok).toBe(true)
  })
  it("el tope suma nuevos y reenviados", () => {
    const r = armarEnvio({
      ...base,
      modo: "reenviar",
      original,
      asunto: "Fwd: x",
      adjuntosNuevos: [{ nombre: "a.zip", tamano: 15 * MB, url: "https://r2.example/a" }],
      adjuntosReenvio: [{ nombre: "b.zip", tamano: 15 * MB, url: "https://r2.example/b" }],
    })
    expect(r).toEqual({ ok: false, error: "Los adjuntos superan el máximo de 40 MB." })
  })
  it("tipo de archivo bloqueado", () => {
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "x", adjuntosNuevos: [{ nombre: "virus.EXE", tamano: 10, url: "https://r2.example/a" }] })
    expect(r).toEqual({ ok: false, error: "No se permite adjuntar archivos .exe." })
  })
  it("el nombre de la casilla no puede romper el from", () => {
    const r = armarEnvio({ ...base, casilla: { nombre: 'Ve"ntas <x>', email: "ventas@cliente.example" }, modo: "nuevo", asunto: "x" })
    if (!r.ok) throw new Error("debía ser ok")
    expect(r.payload.from).toBe("Ventas x <ventas@cliente.example>")
  })
  it("sin asunto queda '(sin asunto)' (la UI confirma antes)", () => {
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "  " })
    if (!r.ok) throw new Error("debía ser ok")
    expect(r.payload.subject).toBe("(sin asunto)")
  })
  it("sin texto ni adjuntos: no se envía vacío", () => {
    const r = armarEnvio({ ...base, modo: "nuevo", asunto: "x", texto: "  " })
    expect(r).toEqual({ ok: false, error: "Escriba un mensaje o adjunte un archivo." })
  })
})

describe("extensionBloqueada / textoAHtml", () => {
  it("detecta extensiones peligrosas sin importar mayúsculas", () => {
    expect(extensionBloqueada("a.exe")).toBe("exe")
    expect(extensionBloqueada("a.Bat")).toBe("bat")
    expect(extensionBloqueada("a.pdf")).toBeNull()
    expect(extensionBloqueada("sin-extension")).toBeNull()
  })
  it("párrafos y saltos", () => {
    expect(textoAHtml("uno\ndos\n\ntres")).toBe("<p>uno<br>dos</p><p>tres</p>")
    expect(textoAHtml("<script>")).toBe("<p>&lt;script&gt;</p>")
  })
})

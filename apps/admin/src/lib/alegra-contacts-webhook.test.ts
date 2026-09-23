import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clavesDelPayload,
  esEventoContacto,
  leerAvisoContacto,
  loguearClavesUnaVez,
  rutaWebhookContactos,
  tokenWebhookContactos,
  tokenWebhookValido,
} from "./alegra-contacts-webhook"

const SECRETO = "s".repeat(40)

afterEach(() => vi.restoreAllMocks())

describe("token de la URL", () => {
  it("es estable por tenant y distinto entre tenants", () => {
    const a = tokenWebhookContactos("tenant-a", SECRETO)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokenWebhookContactos("tenant-a", SECRETO)).toBe(a)
    expect(tokenWebhookContactos("tenant-b", SECRETO)).not.toBe(a)
    expect(tokenWebhookContactos("tenant-a", "t".repeat(40))).not.toBe(a)
  })

  it("sin secreto, o con uno corto, no hay token y nada valida (falla cerrada)", () => {
    expect(tokenWebhookContactos("tenant-a", undefined)).toBeNull()
    expect(tokenWebhookContactos("tenant-a", "corto")).toBeNull()
    expect(tokenWebhookValido("tenant-a", "", undefined)).toBe(false)
    expect(tokenWebhookValido("tenant-a", "cualquiera", "corto")).toBe(false)
  })

  it("valida el token del tenant y rechaza el de otro tenant", () => {
    const a = tokenWebhookContactos("tenant-a", SECRETO)!
    expect(tokenWebhookValido("tenant-a", a, SECRETO)).toBe(true)
    expect(tokenWebhookValido("tenant-b", a, SECRETO)).toBe(false)
    expect(tokenWebhookValido("tenant-a", a.slice(0, -1) + "x", SECRETO)).toBe(false)
    expect(tokenWebhookValido("tenant-a", "", SECRETO)).toBe(false)
  })

  it("la ruta lleva tenant, evento y token", () => {
    expect(rutaWebhookContactos("tenant-a", "edit-client", "tok")).toBe("/api/webhooks/alegra/contactos/tenant-a/edit-client/tok")
  })

  it("solo los tres eventos de contactos", () => {
    expect(["new-client", "edit-client", "delete-client"].every(esEventoContacto)).toBe(true)
    expect(esEventoContacto("new-invoice")).toBe(false)
    expect(esEventoContacto("edit-item")).toBe(false)
  })
})

describe("leerAvisoContacto", () => {
  const completo = { id: 42, name: "Cliente Ejemplo", type: ["client"], status: "active" }

  it("contacto completo bajo message.client / client / contact / data", () => {
    for (const aviso of [{ message: { client: completo } }, { client: completo }, { contact: completo }, { data: completo }]) {
      expect(leerAvisoContacto(aviso)).toEqual({ id: "42", contacto: completo, idSeguro: true })
    }
  })

  it("la raíz es el contacto completo", () => {
    expect(leerAvisoContacto(completo)).toEqual({ id: "42", contacto: completo, idSeguro: true })
  })

  it("solo id: hay que leerlo; un id suelto en la raíz no es seguro para una baja", () => {
    expect(leerAvisoContacto({ id: "42" })).toEqual({ id: "42", contacto: null, idSeguro: false })
    expect(leerAvisoContacto({ message: { client: { id: 42 } } })).toEqual({ id: "42", contacto: null, idSeguro: true })
  })

  it("ids raros o ausentes: null", () => {
    expect(leerAvisoContacto({ id: "../42" }).id).toBeNull()
    expect(leerAvisoContacto({ id: "" }).id).toBeNull()
    expect(leerAvisoContacto({ message: "hola" }).id).toBeNull()
    expect(leerAvisoContacto(null).id).toBeNull()
  })
})

describe("claves del cuerpo, sin valores", () => {
  const aviso = {
    subject: "edit-client",
    message: { client: { id: 42, name: "Cliente Ejemplo", identification: "20123456789", email: "a@cliente.example" } },
  }

  it("lista las claves de primer nivel y las de sus objetos", () => {
    expect(clavesDelPayload(aviso)).toEqual(["subject", "message{client}"])
    expect(clavesDelPayload([1])).toEqual(["(lista)"])
    expect(clavesDelPayload(null)).toEqual(["(object)"])
  })

  it("se loguea una sola vez por tenant y evento, y nunca con valores", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    loguearClavesUnaVez("tenant-claves", "edit-client", aviso)
    loguearClavesUnaVez("tenant-claves", "edit-client", aviso)
    loguearClavesUnaVez("tenant-claves", "new-client", aviso)
    expect(log).toHaveBeenCalledTimes(2)
    const todo = log.mock.calls.flat().join(" ")
    for (const valor of ["Cliente Ejemplo", "20123456789", "a@cliente.example", "42"]) expect(todo).not.toContain(valor)
  })
})

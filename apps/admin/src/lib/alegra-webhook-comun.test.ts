import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clavesDelPayload,
  idDe,
  leerCuerpo,
  loguearClavesUnaVez,
  objeto,
  tokenValido,
  tokenWebhook,
} from "./alegra-webhook-comun"
import { tokenWebhookContactos } from "./alegra-contacts-webhook"

const SECRETO = "s".repeat(40)

afterEach(() => vi.restoreAllMocks())

describe("token por dominio", () => {
  it("hex de 32, estable, y distinto entre dominios para el mismo tenant", () => {
    const stock = tokenWebhook("alegra-stock", "tenant-a", SECRETO)
    const contactos = tokenWebhook("alegra-contactos", "tenant-a", SECRETO)
    expect(stock).toMatch(/^[0-9a-f]{32}$/)
    expect(contactos).toMatch(/^[0-9a-f]{32}$/)
    expect(stock).not.toBe(contactos)
    expect(tokenWebhook("alegra-stock", "tenant-a", SECRETO)).toBe(stock)
    expect(tokenWebhook("alegra-stock", "tenant-b", SECRETO)).not.toBe(stock)
  })

  it("el de contactos sigue siendo el mismo que antes de extraer el común", () => {
    expect(tokenWebhook("alegra-contactos", "tenant-a", SECRETO)).toBe(tokenWebhookContactos("tenant-a", SECRETO))
  })

  it("secreto ausente o corto → null y nada valida", () => {
    expect(tokenWebhook("alegra-stock", "tenant-a", undefined)).toBeNull()
    expect(tokenWebhook("alegra-stock", "tenant-a", "corto")).toBeNull()
    expect(tokenValido("alegra-stock", "tenant-a", "x", "corto")).toBe(false)
  })

  it("valida sólo el token de su dominio y su tenant", () => {
    const stock = tokenWebhook("alegra-stock", "tenant-a", SECRETO)!
    const contactos = tokenWebhook("alegra-contactos", "tenant-a", SECRETO)!
    expect(tokenValido("alegra-stock", "tenant-a", stock, SECRETO)).toBe(true)
    expect(tokenValido("alegra-stock", "tenant-a", contactos, SECRETO)).toBe(false)
    expect(tokenValido("alegra-stock", "tenant-b", stock, SECRETO)).toBe(false)
    expect(tokenValido("alegra-stock", "tenant-a", "", SECRETO)).toBe(false)
  })
})

describe("leerCuerpo", () => {
  const req = (body?: string) => new Request("https://crm.plataforma.example/x", { method: "POST", body })

  it("JSON, formulario, vacío", async () => {
    expect(await leerCuerpo(req('{"a":1}'))).toEqual({ a: 1 })
    expect(await leerCuerpo(req("id=42&event=new-client"))).toEqual({ id: "42", event: "new-client" })
    expect(await leerCuerpo(req(""))).toBeNull()
    expect(await leerCuerpo(req())).toBeNull()
  })

  it("más grande que el tope → null (no se parsea)", async () => {
    expect(await leerCuerpo(req(JSON.stringify({ a: "x".repeat(200) })), 100)).toBeNull()
    expect(await leerCuerpo(req('{"a":1}'), 100)).toEqual({ a: 1 })
  })
})

describe("objeto / idDe", () => {
  it("objeto acepta JSON anidado como texto y rechaza listas", () => {
    expect(objeto('{"id":5}')).toEqual({ id: 5 })
    expect(objeto([1])).toBeNull()
    expect(objeto("hola")).toBeNull()
  })

  it("idDe acepta números y strings razonables", () => {
    expect(idDe({ id: 5 })).toBe("5")
    expect(idDe({ id: " 7 " })).toBe("7")
    expect(idDe({ id: "../5" })).toBeNull()
    expect(idDe(null)).toBeNull()
  })
})

describe("claves del cuerpo", () => {
  it("sin valores, y una sola vez por prefijo, tenant y evento", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const aviso = { subject: "new-invoice", message: { invoice: { id: 10, client: { name: "Cliente Ejemplo" } } } }
    expect(clavesDelPayload(aviso)).toEqual(["subject", "message{invoice}"])
    loguearClavesUnaVez("[alegra-stock]", "tenant-comun", "new-invoice", aviso)
    loguearClavesUnaVez("[alegra-stock]", "tenant-comun", "new-invoice", aviso)
    loguearClavesUnaVez("[otro]", "tenant-comun", "new-invoice", aviso)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls.flat().join(" ")).not.toContain("Cliente Ejemplo")
  })
})

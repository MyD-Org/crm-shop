import { afterEach, describe, expect, it, vi } from "vitest"
import { tokenWebhookStockCuenta } from "./alegra-stock-webhook"
import {
  clavesDelPayload,
  enmascararUrlContactosCuenta,
  esEventoContacto,
  esSuscripcionContactos,
  esSuscripcionContactosCuenta,
  planSuscripcionesContactosCuenta,
  rutaWebhookContactosCuenta,
  tokenWebhookContactosCuenta,
  tokenWebhookContactosCuentaValido,
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
    expect(a).toMatch(/^[0-9a-f]{32}$/)
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

// ── Avisos de contactos de una cuenta SECUNDARIA ──

const CUENTA_MDP = "11111111-1111-4111-8111-111111111111"
const CUENTA_OTRA = "22222222-2222-4222-8222-222222222222"

describe("token y ruta de contactos por cuenta", () => {
  it("es estable por cuenta y distinto del de contactos-tenant y del de stock-cuenta con el mismo id", () => {
    const t = tokenWebhookContactosCuenta(CUENTA_MDP, SECRETO)!
    expect(t).toMatch(/^[0-9a-f]{32}$/)
    expect(tokenWebhookContactosCuenta(CUENTA_MDP, SECRETO)).toBe(t)
    expect(tokenWebhookContactosCuenta(CUENTA_OTRA, SECRETO)).not.toBe(t)
    expect(tokenWebhookContactos(CUENTA_MDP, SECRETO)).not.toBe(t)
    expect(tokenWebhookStockCuenta(CUENTA_MDP, SECRETO)).not.toBe(t)
  })

  it("solo valida el token de la cuenta; falla cerrada sin secreto", () => {
    const t = tokenWebhookContactosCuenta(CUENTA_MDP, SECRETO)!
    expect(tokenWebhookContactosCuentaValido(CUENTA_MDP, t, SECRETO)).toBe(true)
    expect(tokenWebhookContactosCuentaValido(CUENTA_OTRA, t, SECRETO)).toBe(false)
    expect(tokenWebhookContactosCuentaValido(CUENTA_MDP, "", SECRETO)).toBe(false)
    expect(tokenWebhookContactosCuentaValido(CUENTA_MDP, tokenWebhookContactos(CUENTA_MDP, SECRETO)!, SECRETO)).toBe(false)
    expect(tokenWebhookContactosCuentaValido(CUENTA_MDP, t, undefined)).toBe(false)
    expect(tokenWebhookContactosCuenta(CUENTA_MDP, undefined)).toBeNull()
  })

  it("la ruta lleva cuenta, evento y token", () => {
    expect(rutaWebhookContactosCuenta(CUENTA_MDP, "edit-client", "tok")).toBe(
      `/api/webhooks/alegra/contactos-cuenta/${CUENTA_MDP}/edit-client/tok`,
    )
  })
})

describe("suscripciones de contactos por cuenta", () => {
  const base = "https://tenant-a.plataforma.example"
  const sub = (event: string, url: string, id = "1") => ({ id, event, url })
  const deMdp = (event: string, token = "tok") => sub(event, `${base}${rutaWebhookContactosCuenta(CUENTA_MDP, event as "new-client", token)}`)

  it("reconoce solo las de ESA cuenta: no las de otra cuenta, ni las de IGZ, ni las de stock", () => {
    expect(esSuscripcionContactosCuenta(CUENTA_MDP, deMdp("edit-client"))).toBe(true)
    expect(esSuscripcionContactosCuenta(CUENTA_OTRA, deMdp("edit-client"))).toBe(false)
    expect(esSuscripcionContactosCuenta(CUENTA_MDP, sub("edit-client", `${base}/api/webhooks/alegra/contactos/tenant-a/edit-client/tok`))).toBe(false)
    expect(esSuscripcionContactosCuenta(CUENTA_MDP, sub("new-item", `${base}/api/webhooks/alegra/stock-cuenta/${CUENTA_MDP}/new-item/tok`))).toBe(false)
    expect(esSuscripcionContactosCuenta(CUENTA_MDP, deMdp("new-invoice"))).toBe(false)
  })

  it("el predicado de la principal no reconoce las de una cuenta (el script sin --cuenta no las toca)", () => {
    expect(esSuscripcionContactos("tenant-a", sub("edit-client", `${base}/api/webhooks/alegra/contactos/tenant-a/edit-client/tok`))).toBe(true)
    expect(esSuscripcionContactos("tenant-a", deMdp("edit-client"))).toBe(false)
    expect(esSuscripcionContactos(CUENTA_MDP, deMdp("edit-client"))).toBe(false)
  })

  it("el plan es idempotente: con los tres registrados no hay nada que crear", () => {
    const actuales = ["new-client", "edit-client", "delete-client"].map((e, i) => ({ ...deMdp(e), id: String(i) }))
    const plan = planSuscripcionesContactosCuenta(CUENTA_MDP, base, "tok", actuales)
    expect(plan.faltan).toEqual([])
    expect(plan.vigentes.sort()).toEqual(["delete-client", "edit-client", "new-client"])
    expect(plan.viejas).toEqual([])
  })

  it("crea solo las que faltan y marca como viejas las de otra url", () => {
    const plan = planSuscripcionesContactosCuenta(CUENTA_MDP, base, "tok", [deMdp("new-client"), deMdp("edit-client", "viejo")])
    expect(plan.faltan.map((p) => p.event).sort()).toEqual(["delete-client", "edit-client"])
    expect(plan.viejas).toHaveLength(1)
  })

  it("enmascara el token", () => {
    const url = `${base}${rutaWebhookContactosCuenta(CUENTA_MDP, "edit-client", "abcdef0123456789")}`
    const m = enmascararUrlContactosCuenta(url)
    expect(m).toContain("/edit-client/abcd…")
    expect(m).not.toContain("abcdef0123456789")
  })
})

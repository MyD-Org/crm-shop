import { describe, it, expect, afterEach } from "vitest"
import { sessionCookieDomain } from "./session"

// El bug que cubre esto: con COOKIE_DOMAIN=.cliente.example (puesta cuando el CRM era
// un solo cliente), el login en avantec.plataforma.example devolvía success pero el navegador
// descartaba el Set-Cookie por dominio ajeno y el dashboard rebotaba al login.

const original = process.env.COOKIE_DOMAIN

afterEach(() => {
  if (original === undefined) delete process.env.COOKIE_DOMAIN
  else process.env.COOKIE_DOMAIN = original
})

describe("sessionCookieDomain", () => {
  it("aplica el dominio configurado a un subdominio suyo", () => {
    process.env.COOKIE_DOMAIN = ".cliente.example"
    expect(sessionCookieDomain("crm.cliente.example")).toBe(".cliente.example")
  })

  it("aplica el dominio configurado al dominio raíz exacto", () => {
    process.env.COOKIE_DOMAIN = ".cliente.example"
    expect(sessionCookieDomain("cliente.example")).toBe(".cliente.example")
  })

  it("NO lo aplica a un tenant de otro dominio raíz (el bug)", () => {
    process.env.COOKIE_DOMAIN = ".cliente.example"
    expect(sessionCookieDomain("avantec.plataforma.example")).toBeUndefined()
  })

  it("no se deja engañar por un dominio que solo termina parecido", () => {
    process.env.COOKIE_DOMAIN = ".cliente.example"
    expect(sessionCookieDomain("evilcliente.example")).toBeUndefined()
  })

  it("ignora el puerto, las mayúsculas y el punto final del FQDN", () => {
    process.env.COOKIE_DOMAIN = ".cliente.example"
    expect(sessionCookieDomain("CRM.cliente.example:3000")).toBe(".cliente.example")
    expect(sessionCookieDomain("crm.cliente.example.")).toBe(".cliente.example")
  })

  it("sin COOKIE_DOMAIN la cookie queda host-only", () => {
    delete process.env.COOKIE_DOMAIN
    expect(sessionCookieDomain("avantec.plataforma.example")).toBeUndefined()
  })

  it("sin host no arriesga un dominio", () => {
    process.env.COOKIE_DOMAIN = ".cliente.example"
    expect(sessionCookieDomain(null)).toBeUndefined()
  })
})

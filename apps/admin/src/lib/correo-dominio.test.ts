import { describe, expect, it } from "vitest"
import { dominioRecibeCorreo } from "./correo-dominio"

const err = (code: string) => Object.assign(new Error(code), { code })
const resolver = (o: { mx?: unknown; a?: unknown; aaaa?: unknown }) => ({
  resolveMx: async () => {
    if (o.mx instanceof Error) throw o.mx
    return (o.mx ?? []) as { exchange: string; priority: number }[]
  },
  resolve4: async () => {
    if (o.a instanceof Error) throw o.a
    return (o.a ?? []) as string[]
  },
  resolve6: async () => {
    if (o.aaaa instanceof Error) throw o.aaaa
    return (o.aaaa ?? []) as string[]
  },
})

describe("dominioRecibeCorreo", () => {
  it("con MX recibe", async () => {
    expect(await dominioRecibeCorreo("x.example", resolver({ mx: [{ exchange: "mx.x.example", priority: 10 }] }))).toBe(true)
  })
  it("sin MX pero con A (RFC 5321) recibe", async () => {
    expect(await dominioRecibeCorreo("x.example", resolver({ mx: err("ENODATA"), a: ["192.0.2.1"] }))).toBe(true)
  })
  it("sin MX ni A no recibe", async () => {
    expect(await dominioRecibeCorreo("x.example", resolver({ mx: err("ENOTFOUND"), a: err("ENOTFOUND"), aaaa: err("ENOTFOUND") }))).toBe(false)
    expect(await dominioRecibeCorreo("x.example", resolver({ mx: [], a: [], aaaa: [] }))).toBe(false)
  })
  it("MX nulo (RFC 7505) no recibe", async () => {
    expect(await dominioRecibeCorreo("x.example", resolver({ mx: [{ exchange: "", priority: 0 }] }))).toBe(false)
  })
  it("si el DNS falla por timeout u otro error no bloquea", async () => {
    expect(await dominioRecibeCorreo("x.example", resolver({ mx: err("ETIMEOUT") }))).toBe(true)
    expect(await dominioRecibeCorreo("x.example", resolver({ mx: err("ENODATA"), a: err("ESERVFAIL") }))).toBe(true)
  })
  it("un resolver colgado no bloquea (timeout propio)", async () => {
    const colgado = { resolveMx: () => new Promise<never>(() => {}), resolve4: async () => [], resolve6: async () => [] }
    expect(await dominioRecibeCorreo("x.example", colgado, 20)).toBe(true)
  })
})

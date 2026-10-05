import { describe, expect, it } from "vitest"
import type { TenantConfig } from "./tenants"
import type { CuentaCredenciales } from "./sucursales-cuenta"
import { objetivosDeTenant } from "./alegra-contacts-objetivos"

// Qué (cuenta) sincroniza el cron de contactos para un tenant. Sin base: la lectura de cuentas
// se inyecta.

const base = { id: "tenant-a", alegraMock: false, alegraEmail: "igz@plataforma.example", alegraToken: "tok-igz" } as unknown as TenantConfig

const mdp: CuentaCredenciales = { slug: "mdp", principal: false, alegraEmail: "mdp@plataforma.example", alegraToken: "tok-mdp", alegraMock: false }
const sinCreds: CuentaCredenciales = { slug: "sin-creds", principal: false, alegraEmail: "", alegraToken: "", alegraMock: false }

const con = (cuentas: CuentaCredenciales[]) => async () => cuentas
// El entorno de desarrollo no debe colar credenciales en estos tests.
const env = { NODE_ENV: "production" }

describe("objetivosDeTenant", () => {
  it("la principal siempre primero, con la config del tenant", async () => {
    const r = await objetivosDeTenant(base, null, { leerCuentas: con([]), env })
    expect(r).toEqual([{ tenant: "tenant-a", cuenta: "principal", config: base }])
  })

  it("suma cada cuenta secundaria activa con SUS credenciales", async () => {
    const r = await objetivosDeTenant(base, null, { leerCuentas: con([mdp]), env })
    expect(r.map((o) => o.cuenta)).toEqual(["principal", "mdp"])
    expect(r[1].config).toMatchObject({ id: "tenant-a", alegraEmail: "mdp@plataforma.example", alegraToken: "tok-mdp" })
    expect(r[1].motivoSalteo).toBeUndefined()
  })

  it("cuenta activa sin credenciales: objetivo con motivo 'sin_credenciales' y sin config; no corta al resto", async () => {
    const r = await objetivosDeTenant(base, null, { leerCuentas: con([sinCreds, mdp]), env })
    expect(r.map((o) => o.cuenta)).toEqual(["principal", "sin-creds", "mdp"])
    expect(r[1]).toEqual({ tenant: "tenant-a", cuenta: "sin-creds", config: null, motivoSalteo: "sin_credenciales" })
    expect(r[2].config).not.toBeNull()
  })

  it("`soloCuenta` filtra: 'mdp' procesa solo MDP; 'principal' solo la principal", async () => {
    const leerCuentas = con([mdp])
    expect((await objetivosDeTenant(base, "mdp", { leerCuentas, env })).map((o) => o.cuenta)).toEqual(["mdp"])
    expect((await objetivosDeTenant(base, "principal", { leerCuentas, env })).map((o) => o.cuenta)).toEqual(["principal"])
    expect(await objetivosDeTenant(base, "inexistente", { leerCuentas, env })).toEqual([])
  })

  it("si no se pueden leer las cuentas, queda la principal (la sync de siempre)", async () => {
    const r = await objetivosDeTenant(base, null, {
      leerCuentas: async () => {
        throw new Error("sin tabla")
      },
      env,
    })
    expect(r.map((o) => o.cuenta)).toEqual(["principal"])
  })
})

import { describe, expect, it } from "vitest"
import type { TenantConfig } from "./tenants"
import {
  configParaCuenta,
  configParaSucursalSinCuenta,
  credencialesDeDesarrollo,
  esProduccion,
  MSG_SIN_CREDENCIALES,
  MSG_SIN_CUENTA,
  ultimos4,
} from "./sucursales-cuenta"

const BASE: TenantConfig = {
  id: "central-led",
  name: "Empresa de prueba",
  subtitle: "",
  logoPath: "/logos/x.svg",
  alegraEmail: "principal@empresa.example",
  alegraToken: "token-principal-0000",
  alegraMock: false,
  whatsappNumber: "",
  resendFrom: "portal@empresa.example",
  receiptsEmail: "",
  aiApiBaseUrl: "",
  aiApiKey: "",
  aiAgentId: "",
  aiTenantId: "",
}

const ENV_DEV = {
  NODE_ENV: "development",
  CENTRAL_LED_ALEGRA_EMAIL_MDP: "mdp@empresa.example",
  CENTRAL_LED_ALEGRA_TOKEN_MDP: "token-mdp-dev-1234",
}

const secundaria = (extra: Partial<{ alegraEmail: string; alegraToken: string; alegraMock: boolean }> = {}) => ({
  slug: "mdp",
  principal: false,
  alegraEmail: "",
  alegraToken: "",
  alegraMock: false,
  ...extra,
})

describe("configParaCuenta", () => {
  it("la principal devuelve el config del tenant tal cual (sin copiar secretos)", () => {
    const c = configParaCuenta(BASE, { ...secundaria(), slug: "principal", principal: true }, {})
    expect(c).toBe(BASE)
  })
  it("una secundaria con credenciales pisa email/token/mock y conserva el resto del tenant", () => {
    const c = configParaCuenta(BASE, secundaria({ alegraEmail: "mdp@empresa.example", alegraToken: "tk-mdp" }), {})
    expect(c).toMatchObject({ alegraEmail: "mdp@empresa.example", alegraToken: "tk-mdp", alegraMock: false, id: "central-led", resendFrom: BASE.resendFrom })
  })
  it("una secundaria en mock no usa nunca las credenciales de la principal", () => {
    const c = configParaCuenta(BASE, secundaria({ alegraMock: true }), {})
    expect(c).toMatchObject({ alegraMock: true, alegraEmail: "", alegraToken: "" })
  })
  it("sin credenciales y en producción: error en usted, nunca cae a la principal", () => {
    expect(() => configParaCuenta(BASE, secundaria(), { ...ENV_DEV, NODE_ENV: "production" })).toThrow(MSG_SIN_CREDENCIALES)
    expect(() => configParaCuenta(BASE, secundaria(), {})).toThrow(MSG_SIN_CREDENCIALES)
  })
  it("sin credenciales fuera de producción: fallback de desarrollo por variables de entorno", () => {
    const c = configParaCuenta(BASE, secundaria(), ENV_DEV)
    expect(c).toMatchObject({ alegraEmail: "mdp@empresa.example", alegraToken: "token-mdp-dev-1234", alegraMock: false })
  })
  it("las credenciales de la DB mandan sobre el fallback", () => {
    const c = configParaCuenta(BASE, secundaria({ alegraEmail: "db@empresa.example", alegraToken: "tk-db" }), ENV_DEV)
    expect(c.alegraToken).toBe("tk-db")
  })
})

describe("credencialesDeDesarrollo / configParaSucursalSinCuenta", () => {
  it("arma el nombre de la variable con el prefijo del tenant y el slug", () => {
    expect(credencialesDeDesarrollo("central-led", "mdp", ENV_DEV)).toEqual({
      email: "mdp@empresa.example",
      token: "token-mdp-dev-1234",
    })
    expect(credencialesDeDesarrollo("central-led", "igz", ENV_DEV)).toBeNull()
    expect(credencialesDeDesarrollo("otro", "mdp", ENV_DEV)).toBeNull()
  })
  it("está deshabilitado en producción (NODE_ENV o VERCEL_ENV)", () => {
    expect(credencialesDeDesarrollo("central-led", "mdp", { ...ENV_DEV, NODE_ENV: "production" })).toBeNull()
    expect(credencialesDeDesarrollo("central-led", "mdp", { ...ENV_DEV, VERCEL_ENV: "production" })).toBeNull()
    expect(esProduccion({ NODE_ENV: "development" })).toBe(false)
  })
  it("sucursal sin cuenta: usa el fallback o lanza el error de 'sin cuenta asignada'", () => {
    expect(configParaSucursalSinCuenta(BASE, "mdp", ENV_DEV).alegraToken).toBe("token-mdp-dev-1234")
    expect(() => configParaSucursalSinCuenta(BASE, "mdp", {})).toThrow(MSG_SIN_CUENTA)
  })
})

describe("ultimos4", () => {
  it("muestra los últimos 4 solo si el token es largo", () => {
    expect(ultimos4("abcdefghijkl1234")).toBe("1234")
    expect(ultimos4("corto")).toBeNull()
    expect(ultimos4("")).toBeNull()
  })
})

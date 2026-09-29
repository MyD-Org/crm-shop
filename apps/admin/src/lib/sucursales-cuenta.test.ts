import { describe, expect, it } from "vitest"
import type { TenantConfig } from "./tenants"
import {
  configParaCuenta,
  configParaSucursalSinCuenta,
  credencialesDeDesarrollo,
  esProduccion,
  MSG_SIN_CREDENCIALES,
  MSG_SIN_CUENTA,
  esFacturaCruzada,
  resolverCuentaFactura,
  textoMotivoCuentaFactura,
  ultimos4,
  type SucursalCuentaDato,
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


// ── Cuenta que factura un pedido (fixture inventado: dos sucursales, cada una con su cuenta) ──

const CUENTA_IGZ = "11111111-1111-4111-8111-111111111111"
const CUENTA_MDP = "22222222-2222-4222-8222-222222222222"
const SUCURSALES: SucursalCuentaDato[] = [
  { slug: "igz", cuentaAlegraId: CUENTA_IGZ },
  { slug: "mdp", cuentaAlegraId: CUENTA_MDP },
  { slug: "sin-cuenta", cuentaAlegraId: null },
]
const base = { override: null, facturaSucursal: null, sucursales: SUCURSALES, cuentaPrincipalId: CUENTA_IGZ }

describe("resolverCuentaFactura", () => {
  const casos: { nombre: string; entrada: Parameters<typeof resolverCuentaFactura>[0]; esperado: ReturnType<typeof resolverCuentaFactura> }[] = [
    {
      nombre: "por defecto: la cuenta de la sucursal que despacha",
      entrada: { ...base, sucursalDespacho: "mdp" },
      esperado: { cuentaId: CUENTA_MDP, motivo: "despacho", sucursal: "mdp" },
    },
    {
      nombre: "la zona fuerza otra sucursal (Misiones factura por Iguazú aunque despache Mar del Plata)",
      entrada: { ...base, sucursalDespacho: "mdp", facturaSucursal: "igz" },
      esperado: { cuentaId: CUENTA_IGZ, motivo: "zona", sucursal: "igz" },
    },
    {
      nombre: "el operador manda sobre la zona y sobre la sucursal",
      entrada: { ...base, sucursalDespacho: "igz", facturaSucursal: "igz", override: CUENTA_MDP },
      esperado: { cuentaId: CUENTA_MDP, motivo: "override", sucursal: null },
    },
    {
      nombre: "pedido anterior a las sucursales: cuenta principal",
      entrada: { ...base, sucursalDespacho: null },
      esperado: { cuentaId: CUENTA_IGZ, motivo: "principal", sucursal: null },
    },
    {
      nombre: "la sucursal que despacha no tiene cuenta: no se cae a otra en silencio",
      entrada: { ...base, sucursalDespacho: "sin-cuenta" },
      esperado: { cuentaId: null, motivo: "sin_cuenta", sucursal: "sin-cuenta" },
    },
    {
      nombre: "la zona apunta a una sucursal sin cuenta: sin cuenta (no cae al despacho)",
      entrada: { ...base, sucursalDespacho: "mdp", facturaSucursal: "sin-cuenta" },
      esperado: { cuentaId: null, motivo: "sin_cuenta", sucursal: "sin-cuenta" },
    },
    {
      nombre: "sucursal desconocida (dada de baja): sin cuenta",
      entrada: { ...base, sucursalDespacho: "borrada" },
      esperado: { cuentaId: null, motivo: "sin_cuenta", sucursal: "borrada" },
    },
    {
      nombre: "sin sucursal y sin cuenta principal: sin cuenta",
      entrada: { ...base, sucursalDespacho: null, cuentaPrincipalId: null },
      esperado: { cuentaId: null, motivo: "sin_cuenta", sucursal: null },
    },
  ]
  for (const c of casos) it(c.nombre, () => expect(resolverCuentaFactura(c.entrada)).toEqual(c.esperado))
})

describe("esFacturaCruzada", () => {
  const e = { sucursales: SUCURSALES, cuentaPrincipalId: CUENTA_IGZ }
  it("misma cuenta que la sucursal que despacha: no es cruzada", () => {
    expect(esFacturaCruzada({ ...e, cuentaFacturaId: CUENTA_MDP, sucursalDespacho: "mdp" })).toBe(false)
  })
  it("otra cuenta: es cruzada (despacha Mar del Plata, factura Iguazú)", () => {
    expect(esFacturaCruzada({ ...e, cuentaFacturaId: CUENTA_IGZ, sucursalDespacho: "mdp" })).toBe(true)
  })
  it("pedido sin sucursal: se compara contra la cuenta principal", () => {
    expect(esFacturaCruzada({ ...e, cuentaFacturaId: CUENTA_IGZ, sucursalDespacho: null })).toBe(false)
    expect(esFacturaCruzada({ ...e, cuentaFacturaId: CUENTA_MDP, sucursalDespacho: null })).toBe(true)
  })
  it("sin cuenta de facturación o despacho sin cuenta: no se puede afirmar, false", () => {
    expect(esFacturaCruzada({ ...e, cuentaFacturaId: null, sucursalDespacho: "mdp" })).toBe(false)
    expect(esFacturaCruzada({ ...e, cuentaFacturaId: CUENTA_IGZ, sucursalDespacho: "sin-cuenta" })).toBe(false)
  })
})

describe("textoMotivoCuentaFactura", () => {
  it("explica el motivo en usted", () => {
    expect(textoMotivoCuentaFactura("zona", "Misiones")).toBe("Por zona Misiones")
    expect(textoMotivoCuentaFactura("despacho")).toBe("Sucursal que despacha")
    expect(textoMotivoCuentaFactura("sin_cuenta")).toMatch(/no tiene una cuenta/)
  })
})

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { tenants } from "@/db/schema"
import { configDeSucursal, guardarCuentaDeSucursal, listarCuentas } from "@/lib/alegra-cuentas-repo"
import { crearSucursal } from "@/lib/sucursales-repo"
import { MSG_SIN_CUENTA } from "@/lib/sucursales-cuenta"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Repo de cuentas de Alegra por sucursal (change `sucursales-igz-mdp`, D lote 1) contra la base
 * real de test con las migraciones reales (0042). Datos inventados: tenants `tenant-a` / `tenant-b`,
 * slugs `igz` / `mdp`, tokens y CUIT ficticios (el CUIT tiene dígito verificador válido).
 */

const A = "tenant-a"
const B = "tenant-b"
const CUIT = "20111111112"
const TOKEN = "token-secreto-de-prueba-ABCD"

const alta = (tenant: string, slug: string) => crearSucursal(tenant, { slug, nombre: `Sucursal ${slug}` })
const propia = (extra: Record<string, unknown> = {}) => ({
  modo: "propia",
  email: "mdp@cliente.example",
  token: TOKEN,
  cuit: CUIT,
  ...extra,
})

async function tenantConCredenciales(id: string) {
  await seedTenant(id)
  await getDb().update(tenants).set({ alegraEmail: "principal@cliente.example", alegraToken: "token-principal-WXYZ-0000" }).where(eq(tenants.id, id))
}

const ENV_MDP = ["TENANT_A_ALEGRA_EMAIL_MDP", "TENANT_A_ALEGRA_TOKEN_MDP"] as const

afterEach(() => {
  for (const k of ENV_MDP) delete process.env[k]
})
afterAll(async () => {
  await truncateAll()
})
beforeEach(async () => {
  await truncateAll()
  await tenantConCredenciales(A)
  await tenantConCredenciales(B)
  await alta(A, "igz")
  await alta(A, "mdp")
  await alta(B, "mdp")
})

describe("guardarCuentaDeSucursal", () => {
  it("cuenta propia: alta con email, token y CUIT; queda asignada y el DTO no lleva el token", async () => {
    const r = await guardarCuentaDeSucursal(A, "mdp", propia())
    expect(r.kind).toBe("ok")
    expect(JSON.stringify(r)).not.toContain(TOKEN)
    if (r.kind !== "ok" || !r.cuenta) throw new Error("esperaba cuenta")
    expect(r.cuenta).toMatchObject({
      slug: "mdp",
      nombre: "Sucursal mdp",
      cuit: CUIT,
      principal: false,
      email: "mdp@cliente.example",
      tokenConfigurado: true,
      tokenUltimos4: "ABCD",
    })

    const lista = await listarCuentas(A)
    expect(JSON.stringify(lista)).not.toContain(TOKEN)
    expect(lista.asignaciones).toMatchObject({ mdp: "mdp", igz: null })
    expect(lista.cuentas.map((c) => c.slug).sort()).toEqual(["mdp"])
  })

  it("edición: token vacío conserva el guardado; token nuevo lo reemplaza", async () => {
    await guardarCuentaDeSucursal(A, "mdp", propia())
    await guardarCuentaDeSucursal(A, "mdp", { modo: "propia", email: "nuevo@cliente.example", token: "" })
    let c = await configDeSucursal(A, "mdp")
    expect(c).toMatchObject({ kind: "ok", config: { alegraEmail: "nuevo@cliente.example", alegraToken: TOKEN } })

    await guardarCuentaDeSucursal(A, "mdp", { modo: "propia", token: "otro-token-largo-EFGH" })
    c = await configDeSucursal(A, "mdp")
    expect(c).toMatchObject({ kind: "ok", config: { alegraToken: "otro-token-largo-EFGH", alegraEmail: "nuevo@cliente.example" } })
  })

  it("alta sin token o sin correo se rechaza en usted", async () => {
    expect(await guardarCuentaDeSucursal(A, "mdp", propia({ token: "" }))).toEqual({
      kind: "invalid",
      campo: "token",
      error: "Ingrese el token de la cuenta de Alegra.",
    })
    expect(await guardarCuentaDeSucursal(A, "mdp", propia({ email: "" }))).toMatchObject({ kind: "invalid", campo: "email" })
    expect((await listarCuentas(A)).cuentas).toEqual([])
  })

  it("modo principal: crea la fila principal si falta, asigna y guarda el CUIT; el DTO muestra las credenciales del tenant sin token", async () => {
    const r = await guardarCuentaDeSucursal(A, "igz", { modo: "principal", cuit: "20-11111111-2" })
    expect(r.kind).toBe("ok")
    expect(JSON.stringify(r)).not.toContain("token-principal-WXYZ-0000")
    if (r.kind !== "ok" || !r.cuenta) throw new Error("esperaba cuenta")
    expect(r.cuenta).toMatchObject({
      slug: "principal",
      principal: true,
      cuit: CUIT,
      email: "principal@cliente.example",
      tokenConfigurado: true,
      tokenUltimos4: "0000",
    })
    // Una segunda sucursal puede usar la misma principal.
    const r2 = await guardarCuentaDeSucursal(A, "mdp", { modo: "principal" })
    expect(r2.kind).toBe("ok")
    expect((await listarCuentas(A)).cuentas).toHaveLength(1)
  })

  it("modo ninguna quita la asignación pero conserva la cuenta propia (no se pierde el token)", async () => {
    await guardarCuentaDeSucursal(A, "mdp", propia())
    await guardarCuentaDeSucursal(A, "mdp", { modo: "ninguna" })
    const lista = await listarCuentas(A)
    expect(lista.asignaciones.mdp).toBeNull()
    expect(lista.cuentas.map((c) => c.slug)).toEqual(["mdp"])
    // Al volver a "propia" se reutiliza la cuenta con las credenciales nuevas.
    const r = await guardarCuentaDeSucursal(A, "mdp", propia({ email: "otra@cliente.example" }))
    expect(r).toMatchObject({ kind: "ok", cuenta: { email: "otra@cliente.example" } })
    expect((await listarCuentas(A)).cuentas).toHaveLength(1)
  })

  it("cambiar de propia a principal deja la asignación en la principal", async () => {
    await guardarCuentaDeSucursal(A, "mdp", propia())
    await guardarCuentaDeSucursal(A, "mdp", { modo: "principal" })
    const lista = await listarCuentas(A)
    expect(lista.asignaciones.mdp).toBe("principal")
  })

  it("CUIT inválido se rechaza", async () => {
    expect(await guardarCuentaDeSucursal(A, "mdp", propia({ cuit: "20111111113" }))).toMatchObject({ kind: "invalid", campo: "cuit" })
  })

  it("sucursal inexistente o de otro tenant: not_found", async () => {
    expect(await guardarCuentaDeSucursal(A, "no-existe", { modo: "ninguna" })).toEqual({ kind: "not_found" })
    await crearSucursal(B, { slug: "solo-b", nombre: "Solo B" })
    expect(await guardarCuentaDeSucursal(A, "solo-b", { modo: "ninguna" })).toEqual({ kind: "not_found" })
  })

  it("aislamiento por tenant: la misma sucursal 'mdp' en otro tenant tiene su propia cuenta", async () => {
    await guardarCuentaDeSucursal(A, "mdp", propia())
    await guardarCuentaDeSucursal(B, "mdp", propia({ email: "b@cliente.example", token: "token-de-b-largo-9999" }))
    expect((await listarCuentas(A)).cuentas[0]).toMatchObject({ email: "mdp@cliente.example" })
    expect((await listarCuentas(B)).cuentas[0]).toMatchObject({ email: "b@cliente.example" })
  })

  it("un slug de sucursal largo deriva un slug de cuenta de hasta 12 caracteres", async () => {
    await crearSucursal(A, { slug: "mar-del-plata-centro", nombre: "Larga" })
    const r = await guardarCuentaDeSucursal(A, "mar-del-plata-centro", propia())
    expect(r).toMatchObject({ kind: "ok", cuenta: { slug: "mar-del-plat" } })
  })
})

describe("configDeSucursal", () => {
  it("cuenta principal: el config del tenant tal cual", async () => {
    await guardarCuentaDeSucursal(A, "igz", { modo: "principal" })
    expect(await configDeSucursal(A, "igz")).toMatchObject({
      kind: "ok",
      config: { id: A, alegraEmail: "principal@cliente.example", alegraToken: "token-principal-WXYZ-0000" },
    })
  })

  it("cuenta propia: sus credenciales, no las del tenant", async () => {
    await guardarCuentaDeSucursal(A, "mdp", propia())
    expect(await configDeSucursal(A, "mdp")).toMatchObject({
      kind: "ok",
      config: { id: A, alegraEmail: "mdp@cliente.example", alegraToken: TOKEN, alegraMock: false },
    })
  })

  it("sin cuenta y sin variables de desarrollo: 'sin cuenta asignada'", async () => {
    expect(await configDeSucursal(A, "mdp")).toEqual({ kind: "sin_cuenta", error: MSG_SIN_CUENTA })
  })

  it("sin cuenta, fuera de producción: fallback de desarrollo por variables de entorno", async () => {
    process.env.TENANT_A_ALEGRA_EMAIL_MDP = "dev@cliente.example"
    process.env.TENANT_A_ALEGRA_TOKEN_MDP = "token-dev-local-1111"
    expect(await configDeSucursal(A, "mdp")).toMatchObject({
      kind: "ok",
      config: { alegraEmail: "dev@cliente.example", alegraToken: "token-dev-local-1111" },
    })
  })

  it("con credenciales de prueba del formulario: prueba esas sin guardarlas", async () => {
    await guardarCuentaDeSucursal(A, "mdp", propia())
    const r = await configDeSucursal(A, "mdp", { token: "token-nuevo-sin-guardar" })
    expect(r).toMatchObject({ kind: "ok", config: { alegraEmail: "mdp@cliente.example", alegraToken: "token-nuevo-sin-guardar" } })
    expect(await configDeSucursal(A, "mdp")).toMatchObject({ config: { alegraToken: TOKEN } })
  })

  it("sucursal inexistente: not_found", async () => {
    expect(await configDeSucursal(A, "no-existe")).toEqual({ kind: "not_found" })
  })
})

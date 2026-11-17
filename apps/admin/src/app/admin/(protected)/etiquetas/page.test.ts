import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { headersDeSeguridad } from "@/lib/headers-seguridad"
import { SECCIONES, SECCION_POR_CLAVE } from "@/lib/secciones"

// Test a nivel FUENTE (patrón de nav-grupos.test.ts / rutas-guard.test.ts).
const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

describe("/admin/etiquetas", () => {
  it("la página exige admin+: getGuardedAdminSession y notFound() con roleRank < 1", () => {
    const fuente = leer("./page.tsx")
    expect(fuente).toMatch(/getGuardedAdminSession\(\)/)
    expect(fuente).toMatch(/if \(!guard\.ok \|\| roleRank\(guard\.user\.role\) < 1\) notFound\(\)/)
    expect(fuente).toMatch(/export const dynamic = "force-dynamic"/)
  })

  it("tiene una única entrada en el menú, en el grupo Datos y admin+ por defecto", () => {
    expect(SECCIONES.filter((s) => s.href === "/admin/etiquetas")).toHaveLength(1)
    expect(SECCION_POR_CLAVE.etiquetas.grupo).toBe("Datos")
    expect(SECCION_POR_CLAVE.etiquetas.rolMin).toBe("admin")
  })

  it("la API de contexto exige admin+ (requireAdminPlus) y usa el tenant del guard", () => {
    const fuente = leer("../../../api/admin/etiquetas/contexto/route.ts")
    expect(fuente).toMatch(/await requireAdminPlus\(req\)/)
    expect(fuente).toMatch(/armarContexto\(guard\.tenantId/)
  })
})

describe("Permissions-Policy", () => {
  it("no bloquea WebUSB (sin usb=())", () => {
    const pp = headersDeSeguridad({}).find((h) => h.key === "Permissions-Policy")
    expect(pp).toBeDefined()
    expect(pp!.value).not.toMatch(/\busb=\(\)/)
  })
})

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { headersDeSeguridad } from "@/lib/headers-seguridad"
import { SECCIONES, SECCION_POR_CLAVE } from "@/lib/secciones"

// Test a nivel FUENTE (patrón de nav-grupos.test.ts / rutas-guard.test.ts).
const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

describe("/admin/etiquetas", () => {
  it("la página exige la sección Etiquetas: accesoSeccion y notFound() sin ella", () => {
    const fuente = leer("./page.tsx")
    expect(fuente).toMatch(/await accesoSeccion\("etiquetas"\)/)
    expect(fuente).toMatch(/if \(!guard\) notFound\(\)/)
    expect(fuente).toMatch(/export const dynamic = "force-dynamic"/)
  })

  it("tiene una única entrada en el menú, en el grupo Datos y admin+ por defecto", () => {
    expect(SECCIONES.filter((s) => s.href === "/admin/etiquetas")).toHaveLength(1)
    expect(SECCION_POR_CLAVE.etiquetas.grupo).toBe("Datos")
    expect(SECCION_POR_CLAVE.etiquetas.rolMin).toBe("admin")
  })

  it("la API de contexto exige la sección Etiquetas (requireSeccion) y usa el tenant del guard", () => {
    const fuente = leer("../../../api/admin/etiquetas/contexto/route.ts")
    expect(fuente).toMatch(/await requireSeccion\(req, "etiquetas"\)/)
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

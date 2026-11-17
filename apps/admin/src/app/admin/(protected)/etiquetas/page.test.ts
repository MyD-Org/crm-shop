import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { headersDeSeguridad } from "@/lib/headers-seguridad"

// Test a nivel FUENTE (patrón de nav-grupos.test.ts / rutas-guard.test.ts).
const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

describe("/admin/etiquetas", () => {
  it("la página exige admin+: getGuardedAdminSession y notFound() con roleRank < 1", () => {
    const fuente = leer("./page.tsx")
    expect(fuente).toMatch(/getGuardedAdminSession\(\)/)
    expect(fuente).toMatch(/if \(!guard\.ok \|\| roleRank\(guard\.user\.role\) < 1\) notFound\(\)/)
    expect(fuente).toMatch(/export const dynamic = "force-dynamic"/)
  })

  it("todavía no tiene entrada en el menú (llega en R3)", () => {
    expect(leer("../../../../components/admin/AdminShell.tsx")).not.toContain("/admin/etiquetas")
  })
})

describe("Permissions-Policy", () => {
  it("no bloquea WebUSB (sin usb=())", () => {
    const pp = headersDeSeguridad({}).find((h) => h.key === "Permissions-Policy")
    expect(pp).toBeDefined()
    expect(pp!.value).not.toMatch(/\busb=\(\)/)
  })
})

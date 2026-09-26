import { describe, expect, it } from "vitest"
import { buildForgotPasswordEmail } from "@/lib/forgot-password-email"

describe("buildForgotPasswordEmail", () => {
  const base = {
    tenantName: "Empresa <Demo>",
    nombre: "Ana <b>",
    resetUrl: "https://crm.empresa.example/admin/reset-password/abc123",
  }

  it("arma asunto, saludo y botón con escape de HTML", () => {
    const m = buildForgotPasswordEmail(base)
    expect(m.subject).toBe("Empresa <Demo> — Recuperar contraseña")
    expect(m.html).toContain("Empresa &lt;Demo&gt;")
    expect(m.html).toContain("Hola, Ana &lt;b&gt;:")
    expect(m.html).not.toContain("<b>:")
    expect(m.html).toContain(`href="${base.resetUrl}"`)
    expect(m.text).toContain(`Restablecer contraseña: ${base.resetUrl}`)
  })

  it("wording en usted, sin coloquialismos", () => {
    const m = buildForgotPasswordEmail(base)
    expect(m.html).toContain("Si no la solicitó, ignore este mensaje.")
    expect(m.text).toContain("Si no la solicitó, ignore este mensaje.")
    expect(m.html).not.toMatch(/solicitaste|ignorá/i)
  })

  it("saca saltos de línea del asunto", () => {
    const m = buildForgotPasswordEmail({ ...base, tenantName: "Empresa\r\nBcc: x@cliente.example" })
    expect(m.subject).not.toMatch(/[\r\n]/)
  })

  it("es un documento HTML completo con charset", () => {
    const m = buildForgotPasswordEmail(base)
    expect(m.html).toContain("<!doctype html>")
    expect(m.html).toContain('<meta charset="utf-8">')
  })
})

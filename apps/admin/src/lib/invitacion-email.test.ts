import { describe, expect, it } from "vitest"
import { buildInvitacionEmail, roleLabel } from "@/lib/invitacion-email"

describe("roleLabel", () => {
  it("mapea los tres roles conocidos", () => {
    expect(roleLabel("superadmin")).toBe("Superadmin")
    expect(roleLabel("admin")).toBe("Admin")
    expect(roleLabel("operador")).toBe("Operador")
  })

  it("cualquier otro valor cae en Operador", () => {
    expect(roleLabel("lo-que-sea")).toBe("Operador")
  })
})

describe("buildInvitacionEmail", () => {
  const base = {
    tenantName: "Empresa <Demo>",
    nombre: "Ana <b>",
    role: "admin",
    inviteUrl: "https://crm.empresa.example/admin/reset-password/abc123",
  }

  it("arma asunto, saludo, rol y botón con escape de HTML", () => {
    const m = buildInvitacionEmail(base)
    expect(m.subject).toBe("Invitación al backoffice de Empresa <Demo>")
    expect(m.html).toContain("Empresa &lt;Demo&gt;")
    expect(m.html).toContain("Hola, Ana &lt;b&gt;:")
    expect(m.html).toContain("<strong>Admin</strong>")
    expect(m.html).not.toContain("<b>:")
    expect(m.html).toContain(`href="${base.inviteUrl}"`)
    expect(m.text).toContain(`Aceptar invitación y crear contraseña: ${base.inviteUrl}`)
  })

  it("wording en usted (Fue invitado, no Fuiste)", () => {
    const m = buildInvitacionEmail(base)
    expect(m.html).toContain("Fue invitado como")
    expect(m.text).toContain("Fue invitado como")
    expect(m.html).not.toMatch(/fuiste/i)
  })

  it("el link vence en 7 días", () => {
    const m = buildInvitacionEmail(base)
    expect(m.html).toContain("El link vence en 7 días.")
    expect(m.text).toContain("El link vence en 7 días.")
  })

  it("es un documento HTML completo con charset", () => {
    const m = buildInvitacionEmail(base)
    expect(m.html).toContain("<!doctype html>")
    expect(m.html).toContain('<meta charset="utf-8">')
  })
})

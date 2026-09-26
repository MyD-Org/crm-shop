import { describe, expect, it } from "vitest"
import { buildOtpEmail } from "@/lib/otp-email"
import type { TenantConfig } from "@/lib/tenants"

const tenant: TenantConfig = {
  id: "tenant-a",
  name: "Empresa <Demo>",
  subtitle: "",
  logoPath: "/logos/tenant-a.svg",
  alegraEmail: "",
  alegraToken: "",
  alegraMock: true,
  whatsappNumber: "",
  resendFrom: "portal@example.com",
  receiptsEmail: "",
  aiApiBaseUrl: "",
  aiApiKey: "",
  aiAgentId: "",
  aiTenantId: "",
}

describe("buildOtpEmail", () => {
  it("el asunto lleva el código pegado a 'código de verificación', sin separadores", () => {
    const m = buildOtpEmail(tenant, "Ana", "123456")
    expect(m.subject).toBe("123456 es su código de verificación de Empresa <Demo>")
  })

  it("el texto plano tiene la frase literal 'Su código de verificación es NNNNNN'", () => {
    const m = buildOtpEmail(tenant, "Ana", "123456")
    expect(m.text).toContain("Su código de verificación es 123456")
  })

  it("escapa el nombre del cliente y el del tenant en el HTML", () => {
    const m = buildOtpEmail(tenant, "Ana <b>", "123456")
    expect(m.html).toContain("Ana &lt;b&gt;")
    expect(m.html).toContain("Empresa &lt;Demo&gt;")
    expect(m.html).not.toContain("<b>,")
  })

  it("el código va también en el HTML, en el recuadro", () => {
    const m = buildOtpEmail(tenant, "Ana", "123456")
    expect(m.html).toContain(">123456<")
  })

  it("wording en usted", () => {
    const m = buildOtpEmail(tenant, "Ana", "123456")
    expect(m.html).toContain("Si no solicitó este código")
    expect(m.text).toContain("Si no solicitó este código")
  })

  it("es un documento HTML completo con charset", () => {
    const m = buildOtpEmail(tenant, "Ana", "123456")
    expect(m.html).toContain("<!doctype html>")
    expect(m.html).toContain('<meta charset="utf-8">')
  })
})

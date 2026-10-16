import { describe, it, expect } from "vitest"
import { tenantConfigFromRow, plataformaConfigurada } from "./tenants"
import type { tenants } from "@/db/schema"

const fila = (extra: Partial<typeof tenants.$inferSelect> = {}): typeof tenants.$inferSelect =>
  ({
    id: "central-led", name: "Central Led", subtitle: "", logoPath: "", alegraEmail: "", alegraToken: "", alegraMock: true,
    whatsappNumber: "", resendFrom: "", receiptsEmail: "", aiApiUrl: "", aiApiKey: "", aiAgentId: "", aiTenantId: "",
    shopUrl: "", shopInternalUrl: "",
    plataformaUrl: "", plataformaApiKey: "", plataformaWebhookSecret: "", plataformaAtributos: "off",
    ...extra,
  }) as unknown as typeof tenants.$inferSelect

describe("config de plataforma por tenant", () => {
  it("lee las columnas nuevas y el modo por defecto es off", () => {
    const c = tenantConfigFromRow(fila())
    expect(c.plataformaUrl).toBe("")
    expect(c.plataformaAtributos).toBe("off")
    expect(plataformaConfigurada(c)).toBe(false)
  })
  it("está configurada sólo con url, key y secret", () => {
    const c = tenantConfigFromRow(fila({ plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak_x", plataformaWebhookSecret: "a".repeat(64), plataformaAtributos: "dual" }))
    expect(plataformaConfigurada(c)).toBe(true)
    expect(c.plataformaAtributos).toBe("dual")
  })
})

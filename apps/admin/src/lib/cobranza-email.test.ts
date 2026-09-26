import { describe, expect, it } from "vitest"
import { buildCobranzaEmail } from "@/lib/cobranza-email"

describe("buildCobranzaEmail", () => {
  const base = {
    tenantName: "Empresa <Demo>",
    clienteNombre: "Ana <b>",
  }

  it("con vencidas: asunto en plural y singular, título y usted", () => {
    const dos = buildCobranzaEmail({
      ...base,
      items: [
        { facturaId: "A-1", vencimiento: "01/09/2026", saldo: 1000, diasDiff: 5 },
        { facturaId: "A-2", vencimiento: "05/09/2026", saldo: 500, diasDiff: 2 },
      ],
    })
    expect(dos.subject).toBe("Empresa <Demo> — Tiene 2 facturas vencidas")
    expect(dos.html).toContain("Tiene facturas vencidas")

    const una = buildCobranzaEmail({
      ...base,
      items: [{ facturaId: "A-1", vencimiento: "01/09/2026", saldo: 1000, diasDiff: 5 }],
    })
    expect(una.subject).toBe("Empresa <Demo> — Tiene una factura vencida")
  })

  it("sin vencidas: recordatorio de vencimiento próximo", () => {
    const m = buildCobranzaEmail({
      ...base,
      items: [{ facturaId: "A-1", vencimiento: "10/09/2026", saldo: 1000, diasDiff: -3 }],
    })
    expect(m.subject).toBe("Empresa <Demo> — Recordatorio de vencimiento")
    expect(m.html).toContain("Recordatorio de vencimiento")
    expect(m.html).toContain("vence en 3 días")
  })

  it("escapa tenant, cliente y datos de factura en el HTML", () => {
    const m = buildCobranzaEmail({
      tenantName: "Empresa <Demo>",
      clienteNombre: "Ana <b>",
      items: [{ facturaId: "<A-1>", vencimiento: "01/09/2026", saldo: 1000, diasDiff: 1 }],
    })
    expect(m.html).toContain("Empresa &lt;Demo&gt;")
    expect(m.html).toContain("Hola, Ana &lt;b&gt;:")
    expect(m.html).toContain("&lt;A-1&gt;")
    expect(m.html).not.toContain("<b>:")
  })

  it("total: suma los saldos de todas las facturas listadas", () => {
    const m = buildCobranzaEmail({
      ...base,
      items: [
        { facturaId: "A-1", vencimiento: "01/09/2026", saldo: 1000, diasDiff: 1 },
        { facturaId: "A-2", vencimiento: "02/09/2026", saldo: 250.5, diasDiff: 1 },
      ],
    })
    expect(m.html).toContain("1.250,50")
    expect(m.text).toContain("Total:")
    expect(m.text).toContain("1.250,50")
  })

  it("wording en usted, sin coloquialismos", () => {
    const m = buildCobranzaEmail({
      ...base,
      items: [{ facturaId: "A-1", vencimiento: "01/09/2026", saldo: 1000, diasDiff: 1 }],
    })
    expect(m.html).toContain("Si ya realizó el pago, desestime este mensaje")
    expect(m.text).toContain("Si ya realizó el pago, desestime este mensaje")
    expect(m.html).not.toMatch(/realizaste|desestimá|contactate/i)
  })

  it("vence hoy: el estado dice 'vence hoy'", () => {
    const m = buildCobranzaEmail({
      ...base,
      items: [{ facturaId: "A-1", vencimiento: "01/09/2026", saldo: 1000, diasDiff: 0 }],
    })
    expect(m.html).toContain("vence hoy")
  })
})

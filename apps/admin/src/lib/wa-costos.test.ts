import { describe, it, expect } from "vitest"
import {
  bannerText,
  billingPushText,
  fmtMiles,
  isWaBillingKind,
  lastRunText,
  levelText,
  monthLabelUtc,
  usagePercent,
  volumeText,
  waCostsStatus,
  type WaCostsSummary,
} from "./wa-costos"

const base: WaCostsSummary = { month: "2026-10", limit: 1000, numbers: [], errors: [], lastRunAt: null }

describe("formato", () => {
  it("rotula el mes en UTC", () => {
    expect(monthLabelUtc("2026-10")).toBe("octubre de 2026 (UTC)")
    expect(monthLabelUtc("raro")).toBe("raro")
  })
  it("miles con punto y N de 1.000", () => {
    expect(fmtMiles(1000)).toBe("1.000")
    expect(volumeText(800, 1000)).toBe("800 de 1.000")
  })
  it("porcentaje acotado", () => {
    expect(usagePercent(800, 1000)).toBe(80)
    expect(usagePercent(1500, 1000)).toBe(100)
    expect(usagePercent(0, 1000)).toBe(0)
    expect(usagePercent(5, 0)).toBe(0)
  })
  it("nivel unknown dice No se pudo consultar", () => {
    expect(levelText("unknown")).toBe("No se pudo consultar")
  })
})

describe("estado", () => {
  it("errores sin datos = sin-datos, nunca cero", () => {
    expect(waCostsStatus({ ...base, errors: [{ message: "x" }] })).toBe("sin-datos")
  })
  it("nunca consultado = pendiente, no consumo cero", () => {
    expect(waCostsStatus(base)).toBe("pendiente")
  })
  it("consultado sin errores ni números = vacío (consumo cero)", () => {
    expect(waCostsStatus({ ...base, lastRunAt: "2026-10-02T09:05:00Z" })).toBe("vacio")
  })
  it("con números = datos", () => {
    const n = { phone: "+54 9 11 0000-0000", serviceVolume: 1, billedServiceVolume: 0, cost: 0, level: "ok" as const }
    expect(waCostsStatus({ ...base, numbers: [n] })).toBe("datos")
  })
})

describe("cartel", () => {
  const n = (level: "ok" | "warning" | "billing" | "unknown", phone = "+54 11 0000-0000") => ({
    phone, serviceVolume: 850, billedServiceVolume: 0, cost: 0, level,
  })
  it("sin warning ni billing no hay cartel", () => {
    expect(bannerText({ ...base, numbers: [n("ok"), n("unknown")] })).toBeNull()
  })
  it("warning de un número", () => {
    expect(bannerText({ ...base, numbers: [n("warning")] })).toContain("llegó a 850 de 1.000 gratis")
  })
  it("billing manda sobre warning", () => {
    expect(bannerText({ ...base, numbers: [n("warning"), n("billing", "+54 11 1111-1111")] })).toContain("empezó a cobrar")
  })
})

describe("push", () => {
  it("valida el tipo", () => {
    expect(isWaBillingKind("free_80")).toBe(true)
    expect(isWaBillingKind("service_billed")).toBe(true)
    expect(isWaBillingKind("otro")).toBe(false)
  })
  it("textos en usted", () => {
    expect(billingPushText("free_80", "+54 11 0000-0000", 800, 1000).body).toBe(
      "Mensajes de WhatsApp: +54 11 0000-0000 llegó a 800 de 1.000 gratis de este mes.",
    )
    expect(billingPushText("service_billed", "+54 11 0000-0000", 1000, 1000).body).toBe(
      "WhatsApp empezó a cobrar las respuestas de +54 11 0000-0000 este mes.",
    )
  })
})

describe("última actualización", () => {
  it("muestra fecha y hora de Argentina", () => {
    expect(lastRunText("2026-10-02T12:05:00Z")).toMatch(/2\/10.*09:05/)
  })
  it("ISO inválido se devuelve tal cual", () => {
    expect(lastRunText("raro")).toBe("raro")
  })
})

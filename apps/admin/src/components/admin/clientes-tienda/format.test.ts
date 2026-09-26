import { describe, expect, it } from "vitest"
import { fmtFechaCliente } from "./format"

describe("fmtFechaCliente", () => {
  it("usa la hora de Argentina: 02:00 UTC todavía es el día anterior", () => {
    expect(fmtFechaCliente("2026-09-21T02:00:00.000Z")).toBe("20/09/2026")
    expect(fmtFechaCliente("2026-09-21T03:00:00.000Z")).toBe("21/09/2026")
  })

  it("null o inválido ⇒ guion", () => {
    expect(fmtFechaCliente(null)).toBe("—")
    expect(fmtFechaCliente("no-es-fecha")).toBe("—")
  })
})

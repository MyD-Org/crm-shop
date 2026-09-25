import { describe, expect, it } from "vitest";
import { fmtFecha } from "./format";

describe("fmtFecha", () => {
  it("formatea una fecha ISO en español argentino", () => {
    const result = fmtFecha("2026-09-25T15:30:00Z");
    expect(result).toContain("2026");
    expect(result).toContain("septiembre");
  });

  it("respeta la zona horaria de Argentina (no UTC)", () => {
    // 2026-09-26T02:30:00Z es equivalente a 2026-09-25T23:30:00 en Buenos Aires
    // Sin timeZone sería 26 de septiembre, con timeZone es 25
    const result = fmtFecha("2026-09-26T02:30:00Z");
    expect(result).toContain("25");
  });
});

import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { disponibilidadSucursalHabilitada } from "./disponibilidad-sucursal-flag";

/** Lee el flag `disponibilidad-sucursal` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("disponibilidadSucursalHabilitada", () => {
  it("apagado por defecto", async () => {
    expect(await disponibilidadSucursalHabilitada()).toBe(false);
  });

  it("prendido sólo si también está prendido `sucursales`", async () => {
    setFlag("disponibilidad-sucursal", true);
    expect(await disponibilidadSucursalHabilitada()).toBe(false);
    setFlag("sucursales", true);
    expect(await disponibilidadSucursalHabilitada()).toBe(true);
  });

  it("con `sucursales` prendido y el propio apagado, sigue apagado", async () => {
    setFlag("sucursales", true);
    expect(await disponibilidadSucursalHabilitada()).toBe(false);
  });
});

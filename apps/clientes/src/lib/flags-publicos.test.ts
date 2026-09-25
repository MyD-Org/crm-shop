import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { flagsPublicos } from "./flags-publicos";

describe("flagsPublicos", () => {
  it("apagados por defecto (igual que el defaultValue de Vercel Flags)", async () => {
    expect(await flagsPublicos()).toEqual({ soloVisibles: false, cuotas: false });
  });

  it("refleja catalogo-solo-visibles y cuotas", async () => {
    setFlag("catalogo-solo-visibles", true);
    setFlag("cuotas", true);
    expect(await flagsPublicos()).toEqual({ soloVisibles: true, cuotas: true });
  });
});

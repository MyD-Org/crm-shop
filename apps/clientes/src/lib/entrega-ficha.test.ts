import { describe, expect, it } from "vitest";
import { disponibleAntesEn, localPrincipalDeRetiro, retiroDeFicha } from "./entrega-eleccion";
import type { DisponibilidadRetiro } from "./sucursales-disponibilidad";

const ls = [
  { slug: "a", nombre: "Local A" },
  { slug: "b", nombre: "Local B" },
  { slug: "c", nombre: "Local C" },
];
type Est = "disponible" | "con_demora" | "sin_stock";
const r = (estado: Est, demoraDias: number | null = null) => ({ estado, demoraDias, desde: null });
const retiro = (a: ReturnType<typeof r>, b: ReturnType<typeof r>, c?: ReturnType<typeof r>) =>
  ({ a, b, ...(c ? { c } : {}) }) as unknown as Record<string, DisponibilidadRetiro>;

describe("disponibleAntesEn", () => {
  it("otro local con stock hoy y el elegido tarda", () => {
    const ret = retiro(r("con_demora", 7), r("disponible"));
    const { elegido, otros } = retiroDeFicha(ls, ret, "a");
    expect(disponibleAntesEn(elegido!, otros, ret)).toEqual({ local: ls[1], texto: "Disponible hoy" });
  });

  it("elige el más pronto entre varios", () => {
    const ret = retiro(r("sin_stock"), r("con_demora", 5), r("con_demora", 2));
    const { elegido, otros } = retiroDeFicha(ls, ret, "a");
    expect(disponibleAntesEn(elegido!, otros, ret)?.local.slug).toBe("c");
  });

  it("null si el elegido ya es el mejor o empata", () => {
    const ret = retiro(r("disponible"), r("disponible"));
    const { elegido, otros } = retiroDeFicha(ls, ret, "a");
    expect(disponibleAntesEn(elegido!, otros, ret)).toBeNull();
  });

  it("null si los otros tampoco tienen", () => {
    const ret = retiro(r("sin_stock"), r("sin_stock"));
    const { elegido, otros } = retiroDeFicha(ls, ret, "a");
    expect(disponibleAntesEn(elegido!, otros, ret)).toBeNull();
  });
});

describe("localPrincipalDeRetiro", () => {
  it("el más pronto primero y el resto después", () => {
    const ret = retiro(r("con_demora", 4), r("disponible"));
    const { principal, resto } = localPrincipalDeRetiro(ls, ret);
    expect(principal?.slug).toBe("b");
    expect(resto.map((l) => l.slug)).toEqual(["a"]);
  });

  it("sin locales con retiro, sin principal", () => {
    expect(localPrincipalDeRetiro([], {})).toEqual({ principal: null, resto: [] });
  });
});

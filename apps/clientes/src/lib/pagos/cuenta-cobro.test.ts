import { describe, expect, it } from "vitest";
import casos from "./__fixtures__/cuenta-cobro-casos.json";
import { cuentaDeCobro, elegirCuenta, ordenarCandidatas, slugAVariable, type Candidata } from "./cuenta-cobro";

describe("cuentaDeCobro (facturaSucursal ?? sucursal ?? predeterminada)", () => {
  // La misma tabla sirve para comparar con la regla del CRM (`resolverCuentaFactura` sin override).
  it.each(casos)("$nombre", ({ sucursal, facturaSucursal, predeterminada, esperado }) => {
    expect(cuentaDeCobro({ sucursal, facturaSucursal }, predeterminada)).toBe(esperado);
  });
});

describe("slugAVariable", () => {
  it("mayúsculas y guion -> guion bajo", () => {
    expect(slugAVariable("mdp")).toBe("MDP");
    expect(slugAVariable("igz")).toBe("IGZ");
    expect(slugAVariable("mar-del-plata")).toBe("MAR_DEL_PLATA");
  });

  it("es inyectiva sobre un set de slugs válidos distintos", () => {
    const slugs = ["mdp", "igz", "mar-del-plata", "mardelplata", "sucursal-1", "sucursal-2"];
    expect(new Set(slugs.map(slugAVariable)).size).toBe(slugs.length);
  });
});

const c = (cuenta: string, configurada = true, rechazada = false): Candidata => ({ cuenta, configurada, rechazada });

describe("elegirCuenta", () => {
  it("prevista configurada y sin evidencia: la usa, sin fallback", () => {
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp"), c("igz")] })).toEqual({
      ok: true,
      cuenta: "mdp",
      prevista: "mdp",
      fallback: false,
    });
  });

  it("prevista no configurada: la siguiente usable, con fallback", () => {
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp", false), c("igz")] })).toEqual({
      ok: true,
      cuenta: "igz",
      prevista: "mdp",
      fallback: true,
    });
  });

  it("prevista rechazada en este pedido: la siguiente usable", () => {
    const r = elegirCuenta({ prevista: "mdp", candidatas: [c("mdp", true, true), c("igz")] });
    expect(r).toMatchObject({ ok: true, cuenta: "igz", fallback: true });
  });

  it("declarada igual a la prevista usable: válida", () => {
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp"), c("igz")], declarada: "mdp" })).toMatchObject({
      ok: true,
      cuenta: "mdp",
    });
  });

  it("declarada distinta de una prevista usable: cuenta_no_valida", () => {
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp"), c("igz")], declarada: "igz" })).toEqual({
      ok: false,
      motivo: "cuenta_no_valida",
    });
  });

  it("declarada alternativa válida cuando la prevista no es usable", () => {
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp", false), c("igz")], declarada: "igz" })).toMatchObject({
      ok: true,
      cuenta: "igz",
      fallback: true,
    });
  });

  it("declarada desconocida o no usable: cuenta_no_valida", () => {
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp"), c("igz", false)], declarada: "igz" })).toEqual({
      ok: false,
      motivo: "cuenta_no_valida",
    });
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp")], declarada: "otra" })).toEqual({
      ok: false,
      motivo: "cuenta_no_valida",
    });
  });

  it("sin cuentas usables: sin_cuenta", () => {
    expect(elegirCuenta({ prevista: "mdp", candidatas: [c("mdp", false), c("igz", true, true)] })).toEqual({
      ok: false,
      motivo: "sin_cuenta",
    });
    expect(elegirCuenta({ prevista: null, candidatas: [] })).toEqual({ ok: false, motivo: "sin_cuenta" });
  });

  it("prevista null: no hay expectativa, fallback=false", () => {
    expect(elegirCuenta({ prevista: null, candidatas: [c("igz")] })).toEqual({
      ok: true,
      cuenta: "igz",
      prevista: null,
      fallback: false,
    });
  });
});

describe("ordenarCandidatas", () => {
  it("prevista primero, luego la predeterminada y el resto por slug", () => {
    expect(ordenarCandidatas(["zeta", "igz", "alfa", "mdp"], { prevista: "mdp", predeterminada: "igz" })).toEqual([
      "mdp",
      "igz",
      "alfa",
      "zeta",
    ]);
  });

  it("sin prevista ni predeterminada: por slug, sin duplicados", () => {
    expect(ordenarCandidatas(["mdp", "igz", "mdp"], { prevista: null, predeterminada: null })).toEqual(["igz", "mdp"]);
  });

  it("una prevista que no está entre los slugs igual va primero", () => {
    expect(ordenarCandidatas(["igz"], { prevista: "vieja", predeterminada: "igz" })).toEqual(["vieja", "igz"]);
  });
});

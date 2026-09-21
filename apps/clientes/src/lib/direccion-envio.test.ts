import { describe, expect, it } from "vitest";
import { direccionDesdeFacturacion, yaUsaDireccion } from "./direccion-envio";

describe("direccionDesdeFacturacion", () => {
  it("copia calle, ciudad y código postal", () => {
    expect(
      direccionDesdeFacturacion({
        domicilioCalle: "Av. Victoria Aguirre 100",
        domicilioCiudad: "Puerto Iguazú",
        domicilioCp: "3370",
      }),
    ).toEqual({ calle: "Av. Victoria Aguirre 100", ciudad: "Puerto Iguazú", cp: "3370" });
  });

  it("recorta espacios sobrantes", () => {
    expect(direccionDesdeFacturacion({ domicilioCalle: "  San Martín 5 " })?.calle).toBe(
      "San Martín 5",
    );
  });

  it("deja vacíos los datos que faltan", () => {
    expect(direccionDesdeFacturacion({ domicilioCalle: "San Martín 5", domicilioCiudad: null })).toEqual({
      calle: "San Martín 5",
      ciudad: "",
      cp: "",
    });
  });

  it("devuelve null si no hay calle cargada", () => {
    expect(direccionDesdeFacturacion(null)).toBeNull();
    expect(direccionDesdeFacturacion(undefined)).toBeNull();
    expect(direccionDesdeFacturacion({})).toBeNull();
    expect(direccionDesdeFacturacion({ domicilioCalle: "   " })).toBeNull();
  });
});

describe("yaUsaDireccion", () => {
  const fact = { calle: "San Martín 5", ciudad: "Puerto Iguazú", cp: "3370" };

  it("detecta la calle ya usada, sin importar mayúsculas ni espacios", () => {
    expect(yaUsaDireccion(fact, ["Otra 1", "  san   martín 5 "])).toBe(true);
  });

  it("es falso si ninguna coincide", () => {
    expect(yaUsaDireccion(fact, ["Otra 1", ""])).toBe(false);
    expect(yaUsaDireccion(fact, [])).toBe(false);
  });

  it("es falso si no hay dirección de facturación", () => {
    expect(yaUsaDireccion(null, ["San Martín 5"])).toBe(false);
  });
});

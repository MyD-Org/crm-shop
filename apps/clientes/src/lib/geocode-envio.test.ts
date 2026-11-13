import { describe, expect, it } from "vitest";
import { calleConAlturaAlFrente, urlEstructurada, urlLibre, urlLibreAcotada } from "./geocode-envio";

const c = { texto: "Av. Colón 2500", ciudad: "Mar del Plata", provincia: "Buenos Aires", pais: "ar", idioma: "es" };

describe("calleConAlturaAlFrente", () => {
  it("pasa el número al frente", () => {
    expect(calleConAlturaAlFrente("Av. Colón 2500")).toBe("2500 Av. Colón");
    expect(calleConAlturaAlFrente("  Colón,  2500 ")).toBe("2500 Colón");
  });
  it("sin número queda igual", () => {
    expect(calleConAlturaAlFrente("Av. Colón")).toBe("Av. Colón");
  });
  it("no toca un texto que es sólo un número", () => {
    expect(calleConAlturaAlFrente("2500")).toBe("2500");
  });
});

describe("urlEstructurada", () => {
  it("acota por calle, ciudad y provincia", () => {
    const u = urlEstructurada(c);
    expect(u.searchParams.get("street")).toBe("2500 av. colón");
    expect(u.searchParams.get("city")).toBe("mar del plata");
    expect(u.searchParams.get("state")).toBe("buenos aires");
    expect(u.searchParams.get("countrycodes")).toBe("ar");
    expect(u.searchParams.get("q")).toBeNull();
  });
});

describe("urlLibreAcotada", () => {
  it("arma q con calle, ciudad y provincia", () => {
    expect(urlLibreAcotada(c).searchParams.get("q")).toBe("av. colón 2500, mar del plata, buenos aires");
  });
});

describe("urlLibre", () => {
  it("es la consulta nacional de siempre", () => {
    const u = urlLibre("San Martín 100", "ar", "es");
    expect(u.searchParams.get("q")).toBe("san martín 100");
    expect(u.searchParams.get("street")).toBeNull();
  });
});

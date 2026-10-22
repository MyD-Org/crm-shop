import { describe, expect, it } from "vitest";
import { cuentaValida, eventoPosthog, urlPerfil, utmDe } from "./redireccion-instagram";

describe("redirección a Instagram", () => {
  it("acepta usuarios de Instagram y rechaza cualquier otra cosa", () => {
    expect(cuentaValida("tienda.ejemplo_1")).toBe(true);
    expect(cuentaValida("")).toBe(false);
    expect(cuentaValida("a".repeat(31))).toBe(false);
    expect(cuentaValida("evil.example/x")).toBe(false);
    expect(cuentaValida("https:")).toBe(false);
  });

  it("el destino siempre es instagram.com", () => {
    expect(urlPerfil("tienda.ejemplo")).toBe("https://www.instagram.com/tienda.ejemplo/");
  });

  it("toma sólo los utm_* de la consulta", () => {
    const p = new URLSearchParams("utm_source=qr&utm_campaign=local&volver=/x&fbclid=1");
    expect(utmDe(p)).toEqual({ utm_source: "qr", utm_campaign: "local" });
  });

  it("arma el evento anónimo con la URL limpia", () => {
    const e = eventoPosthog({
      key: "phc_x",
      distinctId: "d1",
      origen: "https://tienda.example",
      cuenta: "tienda.ejemplo",
      params: new URLSearchParams("utm_source=qr&otro=1"),
    });
    expect(e.event).toBe("redireccion_instagram");
    expect(e.properties).toEqual({
      utm_source: "qr",
      cuenta_instagram: "tienda.ejemplo",
      $current_url: "https://tienda.example/ig/tienda.ejemplo?utm_source=qr",
      $process_person_profile: false,
    });
  });
});

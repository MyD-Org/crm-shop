import { describe, expect, it } from "vitest";
import { disponible, mensajeError, reducirToggle, revertir } from "./favoritos-cliente";

describe("reducirToggle", () => {
  it("un id que no estaba se agrega con PUT, sin mutar el original", () => {
    const ids = new Set(["7"]);
    const { siguiente, metodo } = reducirToggle(ids, "42");
    expect(metodo).toBe("PUT");
    expect([...siguiente].sort()).toEqual(["42", "7"]);
    expect([...ids]).toEqual(["7"]);
  });

  it("un id que estaba se quita con DELETE, sin mutar el original", () => {
    const ids = new Set(["42", "7"]);
    const { siguiente, metodo } = reducirToggle(ids, "42");
    expect(metodo).toBe("DELETE");
    expect([...siguiente]).toEqual(["7"]);
    expect(ids.has("42")).toBe(true);
  });
});

describe("revertir", () => {
  it("deshace un PUT fallido", () => {
    const { siguiente, metodo } = reducirToggle(new Set(["7"]), "42");
    expect([...revertir(siguiente, "42", metodo)]).toEqual(["7"]);
  });

  it("deshace un DELETE fallido", () => {
    const { siguiente, metodo } = reducirToggle(new Set(["42", "7"]), "42");
    expect([...revertir(siguiente, "42", metodo)].sort()).toEqual(["42", "7"]);
  });

  it("sólo toca ese id: respeta otros cambios hechos mientras tanto", () => {
    const ids = new Set(["42", "9"]);
    expect([...revertir(ids, "42", "PUT")]).toEqual(["9"]);
  });
});

describe("mensajeError", () => {
  it("429 → demasiadas solicitudes", () => {
    expect(mensajeError(429)).toBe("Demasiadas solicitudes. Inténtelo de nuevo en unos minutos.");
  });

  it("422 → el mensaje del servidor (tope)", () => {
    expect(mensajeError(422, { error: "Alcanzó el máximo de 200 favoritos." })).toBe(
      "Alcanzó el máximo de 200 favoritos.",
    );
  });

  it("422 sin mensaje, 500 y error de red (0) → genérico", () => {
    const generico = "No pudimos guardar el favorito. Inténtelo de nuevo.";
    expect(mensajeError(422)).toBe(generico);
    expect(mensajeError(500, { error: "detalle interno" })).toBe(generico);
    expect(mensajeError(0)).toBe(generico);
  });
});

describe("disponible", () => {
  it("con Clerk siempre", () => {
    expect(disponible({ isSignedIn: true, favoritosBloqueados: true })).toBe(true);
    expect(disponible({ isSignedIn: true, favoritosBloqueados: false })).toBe(true);
  });

  it("anónimo sí (el corazón abre el ingreso)", () => {
    expect(disponible({ isSignedIn: false, favoritosBloqueados: false })).toBe(true);
    expect(disponible({ isSignedIn: undefined, favoritosBloqueados: false })).toBe(true);
  });

  it("cookie del CRM sin Clerk no", () => {
    expect(disponible({ isSignedIn: false, favoritosBloqueados: true })).toBe(false);
    expect(disponible({ isSignedIn: undefined, favoritosBloqueados: true })).toBe(false);
  });
});

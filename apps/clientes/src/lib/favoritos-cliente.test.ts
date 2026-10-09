import { describe, expect, it } from "vitest";
import {
  disponible,
  mensajeError,
  mensajeResultadoLote,
  reducirToggle,
  revertir,
  visiblesEnLista,
} from "./favoritos-cliente";

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

describe("visiblesEnLista", () => {
  const productos = [{ id: "42" }, { id: "7" }, { id: "9" }];

  it("antes de ready muestra lo que mandó el servidor", () => {
    expect(visiblesEnLista(productos, false, () => false)).toEqual(productos);
  });

  it("después de ready oculta al instante lo que se quitó, en el mismo orden", () => {
    const guardados = new Set(["42", "9"]);
    expect(visiblesEnLista(productos, true, (id) => guardados.has(id)).map((p) => p.id)).toEqual([
      "42",
      "9",
    ]);
  });
});

describe("mensajeResultadoLote", () => {
  const base = { agregados: 0, yaEstaban: 0, sinLugar: 0, noDisponibles: 0 };

  it("agregó varios", () => {
    expect(mensajeResultadoLote({ ...base, agregados: 5 })).toBe("Se agregaron 5 productos a sus favoritos.");
  });
  it("agregó uno", () => {
    expect(mensajeResultadoLote({ ...base, agregados: 1 })).toBe("Se agregaron 1 producto a sus favoritos.");
  });
  it("ya estaban todos", () => {
    expect(mensajeResultadoLote({ ...base, yaEstaban: 3 })).toBe("Ya los tenía todos en sus favoritos.");
  });
  it("tope parcial", () => {
    expect(mensajeResultadoLote({ ...base, agregados: 2, sinLugar: 3 })).toBe(
      "Se agregaron 2. No hubo lugar para 3: alcanzó el máximo de 200 favoritos.",
    );
  });
  it("0 agregados por el tope", () => {
    expect(mensajeResultadoLote({ ...base, sinLugar: 4 })).toBe(
      "No se agregó ninguno: alcanzó el máximo de 200 favoritos.",
    );
  });
});

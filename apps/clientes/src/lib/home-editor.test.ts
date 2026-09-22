import { describe, expect, it } from "vitest";
import { DEFAULTS_HOME, SECCIONES_HOME, erroresSeccion } from "@/data/home-defaults";
import {
  agregarItem,
  moverItem,
  normalizarPayload,
  nuevoEnlace,
  nuevoServicio,
  nuevoTile,
  quitarItem,
  TITULOS_SECCION,
} from "./home-editor";

describe("moverItem", () => {
  it("mueve un item de posición", () => {
    const lista = ["a", "b", "c"];
    expect(moverItem(lista, 2, -1)).toEqual(["a", "c", "b"]);
    expect(lista).toEqual(["a", "b", "c"]);
  });

  it("no cambia nada en los bordes", () => {
    expect(moverItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moverItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("quitarItem y agregarItem", () => {
  it("quitarItem elimina por índice", () => {
    expect(quitarItem(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("quitarItem con índice fuera de rango no lanza", () => {
    expect(quitarItem(["a"], 5)).toEqual(["a"]);
  });

  it("agregarItem agrega al final", () => {
    expect(agregarItem(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("constructores de items nuevos", () => {
  it("nuevoEnlace", () => {
    expect(nuevoEnlace()).toEqual({ label: "", href: "/catalogo" });
  });

  it("nuevoTile hereda la imagen del primer tile de ambientes", () => {
    expect(nuevoTile().imagen).toBe(DEFAULTS_HOME.ambientes.items[0].imagen);
  });

  it("nuevoServicio", () => {
    expect(nuevoServicio()).toEqual({ titulo: "", texto: "" });
  });
});

describe("normalizarPayload", () => {
  it("trim de strings y acento vacío se omite", () => {
    const r = normalizarPayload("hero", { ...DEFAULTS_HOME.hero, titulo: "  Hola  ", acento: "" }) as Record<
      string,
      unknown
    >;
    expect(r.titulo).toBe("Hola");
    expect("acento" in r).toBe(false);
  });

  it("destacados.cantidad se convierte a número y conserva skus/imagenes", () => {
    const r = normalizarPayload("destacados", { ...DEFAULTS_HOME.destacados, cantidad: "8" }) as Record<
      string,
      unknown
    >;
    expect(r.cantidad).toBe(8);
    expect(r.skus).toEqual(DEFAULTS_HOME.destacados.skus);
    expect(r.imagenes).toEqual(DEFAULTS_HOME.destacados.imagenes);
  });

  it("marquee descarta items vacíos", () => {
    const r = normalizarPayload("marquee", { items: ["A", " ", "B"] }) as { items: string[] };
    expect(r.items).toEqual(["A", "B"]);
  });

  it("hero.usps descarta usps con label vacío", () => {
    const r = normalizarPayload("hero", { ...DEFAULTS_HOME.hero, usps: [{ label: "x" }, { label: " " }] }) as {
      usps: { label: string }[];
    };
    expect(r.usps).toEqual([{ label: "x" }]);
  });

  it("navBadge null pasa tal cual", () => {
    expect(normalizarPayload("navBadge", null)).toBeNull();
  });

  it("normalizado + validado es idempotente para todos los defaults (salvo navBadge)", () => {
    for (const key of SECCIONES_HOME) {
      if (key === "navBadge") continue;
      const payload = normalizarPayload(key, DEFAULTS_HOME[key as keyof typeof DEFAULTS_HOME]);
      expect(erroresSeccion(key, payload)).toEqual([]);
    }
  });
});

describe("TITULOS_SECCION", () => {
  it("cubre todas las SECCIONES_HOME", () => {
    expect(Object.keys(TITULOS_SECCION).sort()).toEqual([...SECCIONES_HOME].sort());
  });
});

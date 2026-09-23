import { describe, expect, it } from "vitest";
import { DEFAULTS_HOME, SECCIONES_HOME, erroresSeccion } from "@/data/home-defaults";
import {
  agregarItem,
  aMarcas,
  aMascara,
  alternarAcento,
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

  it("hero.imagenAlt vacío se omite (opcional)", () => {
    const r = normalizarPayload("hero", { ...DEFAULTS_HOME.hero, imagenAlt: "" }) as Record<string, unknown>;
    expect("imagenAlt" in r).toBe(false);
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
      expect(erroresSeccion(key, payload, ["media.plataforma.example"])).toEqual([]);
    }
  });

  it("ambientes.bajada vacía se omite (rebanada B2)", () => {
    const r = normalizarPayload("ambientes", { ...DEFAULTS_HOME.ambientes, bajada: "" }) as Record<string, unknown>;
    expect("bajada" in r).toBe(false);
  });

  it("destacados.skus recorta espacios y descarta vacíos (rebanada D)", () => {
    const r = normalizarPayload("destacados", { ...DEFAULTS_HOME.destacados, skus: ["A", " ", "B"] }) as {
      skus: string[];
    };
    expect(r.skus).toEqual(["A", "B"]);
  });

  it("destacados.skus vacío tras filtrar se omite (rebanada D)", () => {
    const r = normalizarPayload("destacados", { ...DEFAULTS_HOME.destacados, skus: ["  "] }) as Record<
      string,
      unknown
    >;
    expect("skus" in r).toBe(false);
  });

  it("decoGrid descarta chips con label vacío (rebanada B2)", () => {
    const r = normalizarPayload("decoGrid", {
      ...DEFAULTS_HOME.decoGrid,
      chips: [{ label: " ", href: "/x" }, { label: "A", href: "/a" }],
    }) as { chips: { label: string; href: string }[] };
    expect(r.chips).toEqual([{ label: "A", href: "/a" }]);
  });

  it("ambientes.items recorta espacios y conserva la imagen (rebanada B2)", () => {
    const tile = DEFAULTS_HOME.ambientes.items[0];
    const r = normalizarPayload("ambientes", {
      ...DEFAULTS_HOME.ambientes,
      items: [{ ...tile, titulo: "  T  " }],
    }) as { items: { titulo: string; imagen: string }[] };
    expect(r.items[0].titulo).toBe("T");
    expect(r.items[0].imagen).toBe(tile.imagen);
  });

  it("nuevoTile() valida una vez completados eyebrow y titulo", () => {
    const tile = { ...nuevoTile(), eyebrow: "Interior", titulo: "Nuevo ambiente" };
    const r = normalizarPayload("ambientes", { ...DEFAULTS_HOME.ambientes, items: [tile] });
    expect(erroresSeccion("ambientes", r)).toEqual([]);
  });
});

describe("TITULOS_SECCION", () => {
  it("cubre todas las SECCIONES_HOME", () => {
    expect(Object.keys(TITULOS_SECCION).sort()).toEqual([...SECCIONES_HOME].sort());
  });
});

describe("máscara de acento (editor sin asteriscos)", () => {
  it("aMascara y aMarcas son inversas", () => {
    const m = aMascara("Todo lo que *su proyecto* necesita");
    expect(m.texto).toBe("Todo lo que su proyecto necesita");
    expect(m.acento.filter(Boolean)).toHaveLength("su proyecto".length);
    expect(aMarcas(m)).toBe("Todo lo que *su proyecto* necesita");
  });

  it("aMarcas deja los espacios de los bordes fuera de las marcas", () => {
    const texto = "Los más vendidos";
    const acento = [...texto].map((_, i) => i >= 3); // " más vendidos"
    expect(aMarcas({ texto, acento })).toBe("Los *más vendidos*");
  });

  it("aMarcas descarta asteriscos escritos a mano", () => {
    expect(aMarcas({ texto: "Precio *especial", acento: Array(16).fill(false) })).toBe("Precio especial");
  });
});

describe("alternarAcento (offsets sobre el texto plano)", () => {
  const plano = "Todo lo que su proyecto necesita";
  const desde = plano.indexOf("proyecto");
  const hasta = desde + "proyecto".length;

  it("pinta la selección", () => {
    expect(alternarAcento(plano, desde, hasta)).toBe("Todo lo que su *proyecto* necesita");
  });

  it("si ya estaba todo pintado, lo despinta", () => {
    expect(alternarAcento("Todo lo que su *proyecto* necesita", desde, hasta)).toBe(plano);
  });

  it("si estaba pintado a medias, pinta todo y une los tramos", () => {
    const d = plano.indexOf("su");
    expect(alternarAcento("Todo lo que su *proyecto* necesita", d, hasta)).toBe("Todo lo que *su proyecto* necesita");
  });

  it("ignora los espacios de los bordes (doble clic)", () => {
    expect(alternarAcento(plano, desde - 1, hasta + 1)).toBe("Todo lo que su *proyecto* necesita");
  });

  it("sin selección devuelve null", () => {
    expect(alternarAcento(plano, 4, 4)).toBeNull();
    expect(alternarAcento(plano, 4, 5)).toBeNull(); // solo un espacio
  });
});

describe("normalizarPayload: textos opcionales", () => {
  it("eyebrow, título y bajada de mobile vacíos se omiten", () => {
    const r = normalizarPayload("hero", {
      ...DEFAULTS_HOME.hero,
      eyebrow: "",
      tituloMobile: " ",
      bajadaMobile: "",
    }) as Record<string, unknown>;
    expect("eyebrow" in r).toBe(false);
    expect("tituloMobile" in r).toBe(false);
    expect("bajadaMobile" in r).toBe(false);
    expect(erroresSeccion("hero", r)).toEqual([]);
  });

  it("camposOcultos vacío se omite; con campos se conserva", () => {
    const vacio = normalizarPayload("hero", { ...DEFAULTS_HOME.hero, camposOcultos: [] }) as Record<string, unknown>;
    expect("camposOcultos" in vacio).toBe(false);
    const con = normalizarPayload("hero", { ...DEFAULTS_HOME.hero, camposOcultos: ["eyebrow"] });
    expect(erroresSeccion("hero", con)).toEqual([]);
  });

  it("el eyebrow vacío de un tile se omite y el tile valida", () => {
    const items = [{ ...nuevoTile(), titulo: "Cocina" }];
    const r = normalizarPayload("decoGrid", { ...DEFAULTS_HOME.decoGrid, items }) as { items: Record<string, unknown>[] };
    expect("eyebrow" in r.items[0]).toBe(false);
    expect(erroresSeccion("decoGrid", r)).toEqual([]);
  });

  it("una sección con todos los textos vacíos se normaliza a algo válido", () => {
    const vacios = (o: object): object =>
      Object.fromEntries(
        Object.entries(o).map(([k, v]) => [k, typeof v === "string" && k !== "imagen" && k !== "href" ? "" : v]),
      );
    const hero = normalizarPayload("hero", {
      ...vacios(DEFAULTS_HOME.hero),
      ctas: [{ label: "", href: "/catalogo" }],
      usps: [{ label: "" }],
    });
    expect(erroresSeccion("hero", hero)).toEqual([]);
    const banner = normalizarPayload("bannerDeco", {
      ...vacios(DEFAULTS_HOME.bannerDeco),
      cta: { label: "", href: "/catalogo" },
    }) as Record<string, unknown>;
    expect("cta" in banner).toBe(false);
    expect(erroresSeccion("bannerDeco", banner)).toEqual([]);
    const servicios = normalizarPayload("servicios", { items: [{ titulo: "", texto: "" }, { titulo: "Envío" }] });
    expect(servicios).toEqual({ items: [{ titulo: "Envío" }] });
    for (const s of ["ambientes", "destacados", "decoGrid", "whatsapp", "anuncio"] as const) {
      const r = normalizarPayload(s, vacios(DEFAULTS_HOME[s]));
      expect(erroresSeccion(s, r), s).toEqual([]);
    }
  });
});

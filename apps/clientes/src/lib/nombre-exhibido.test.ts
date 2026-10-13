import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { descripcionExhibida, nombreExhibido, nombreExhibidoAgrupadoSql } from "./nombre-exhibido";

describe("nombreExhibido", () => {
  it("prefiere el nombre curado en el CRM", () => {
    expect(nombreExhibido({ overlayNombre: "Curado", description: "Descripción", name: "COD-1", code: "COD-1" })).toBe("Curado");
  });

  it("sin curado, el name de Alegra (la descripción son características)", () => {
    expect(
      nombreExhibido({ overlayNombre: null, description: "2 PIEZAS/JUEGO", name: "PUNTAS PH2 X 50MM", code: "JDSV2K12-JDV" })
    ).toBe("PUNTAS PH2 X 50MM");
  });

  it("si el name es el código, la descripción de Alegra", () => {
    expect(nombreExhibido({ overlayNombre: null, description: "TERMICA 2X16", name: "JDSDA261", code: "JDSDA261-JDV" })).toBe("TERMICA 2X16");
    expect(nombreExhibido({ overlayNombre: null, description: "TERMICA 2X16", name: "COD-1", code: "COD-1" })).toBe("TERMICA 2X16");
  });

  it("sin referencia usa el name", () => {
    expect(nombreExhibido({ overlayNombre: null, description: "Descripción", name: "COD-1", code: null })).toBe("COD-1");
  });

  it("un texto vacío no pisa: cae al siguiente", () => {
    expect(nombreExhibido({ overlayNombre: "", description: "", name: "COD-1", code: "COD-1" })).toBe("COD-1");
    expect(nombreExhibido({ overlayNombre: "  ", description: null, name: "COD-1", code: "COD-1" })).toBe("COD-1");
  });
});

describe("descripcionExhibida", () => {
  it("cuando el name es el código, la descripción ES el nombre exhibido: no hay descripción que mostrar", () => {
    expect(
      descripcionExhibida({ overlayNombre: null, description: "TERMICA 2X16", name: "JDSDA261", code: "JDSDA261-JDV" })
    ).toBeUndefined();
  });

  it("misma idea con mayúsculas/espacios distintos (normaliza antes de comparar)", () => {
    expect(
      descripcionExhibida({ overlayNombre: null, description: "  termica   2x16 ", name: "JDSDA261", code: "JDSDA261-JDV" })
    ).toBeUndefined();
  });

  it("si la descripción agrega información, se muestra", () => {
    expect(
      descripcionExhibida({ overlayNombre: null, description: "2 PIEZAS/JUEGO", name: "PUNTAS PH2 X 50MM", code: "JDSV2K12-JDV" })
    ).toBe("2 PIEZAS/JUEGO");
  });

  it("sin descripción, undefined", () => {
    expect(descripcionExhibida({ overlayNombre: null, description: null, name: "COD-1", code: "COD-1" })).toBeUndefined();
    expect(descripcionExhibida({ overlayNombre: null, description: "  ", name: "COD-1", code: "COD-1" })).toBeUndefined();
  });

  it("un nombre curado en el CRM igual a la descripción también la vacía", () => {
    expect(
      descripcionExhibida({ overlayNombre: "Termica 2x16", description: "TERMICA 2X16", name: "COD-1", code: "COD-1" })
    ).toBeUndefined();
  });
});

describe("nombreExhibido con variantes (flag variantes-selector)", () => {
  const variante = {
    overlayNombre: null,
    description: null,
    code: "OPT3-BC",
    name: "Optic 3 / Blanco cálido",
    tipo: "variante",
    grupoId: "10",
    etiqueta: "Blanco cálido",
  };
  it("variante de Alegra sin nombre curado: el nombre del modelo, sin la opción", () => {
    expect(nombreExhibido(variante)).toBe("Optic 3");
  });
  it("ignora mayúsculas y espacios del sufijo", () => {
    expect(nombreExhibido({ ...variante, etiqueta: "  BLANCO cálido " })).toBe("Optic 3");
  });
  it("con nombre curado en el ancla manda el curado", () => {
    expect(nombreExhibido({ ...variante, overlayNombre: "Panel Optic" })).toBe("Panel Optic");
  });
  it("grupo manual (tipo simple): el name queda como está", () => {
    expect(nombreExhibido({ ...variante, tipo: "simple", name: "Bulbo G120 cálido 2700K", etiqueta: "2700K" })).toBe(
      "Bulbo G120 cálido 2700K",
    );
  });
  it("si el name no termina en ' / ' + etiqueta, queda igual", () => {
    expect(nombreExhibido({ ...variante, name: "Optic 3 Blanco cálido" })).toBe("Optic 3 Blanco cálido");
  });
  it("sin grupo (producto suelto o flag apagado, sin esos campos): como siempre", () => {
    expect(nombreExhibido({ ...variante, grupoId: null })).toBe("Optic 3 / Blanco cálido");
    const { tipo, grupoId, etiqueta, ...sinCampos } = variante;
    void tipo; void grupoId; void etiqueta;
    expect(nombreExhibido(sinCampos)).toBe("Optic 3 / Blanco cálido");
  });
  it("el name igual a la etiqueta no queda vacío", () => {
    expect(nombreExhibido({ ...variante, name: " / Blanco cálido" })).toBe(" / Blanco cálido");
  });
});

describe("nombreExhibidoAgrupadoSql", () => {
  it("quita el sufijo sólo si es variante de un grupo sin nombre curado, y cae a nombreExhibidoSql", () => {
    const q = new PgDialect().sqlToQuery(nombreExhibidoAgrupadoSql);
    expect(q.sql).toContain("'variante'");
    expect(q.sql).toContain('"grupo_id" IS NOT NULL');
    expect(q.sql).toContain("' / ' || btrim(");
    expect(q.sql).toContain("ELSE coalesce(");
  });
});

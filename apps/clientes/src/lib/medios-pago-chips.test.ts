import { describe, expect, it } from "vitest";
import { MAX_CHIPS_MEDIO, leerChipsMedio, tonoBadgeDeChip } from "./medios-pago-chips";

describe("leerChipsMedio (tolerante)", () => {
  it("lo ausente o inválido da []", () => {
    for (const v of [undefined, null, "x", 5, {}, true]) expect(leerChipsMedio(v)).toEqual([]);
  });

  it("conserva los chips válidos en el orden cargado", () => {
    const v = [
      { texto: "Hasta 8 cuotas sin interés", tono: "destacado" },
      { texto: "15% OFF", tono: "exito" },
      { texto: "Promo del mes", tono: "info" },
    ];
    expect(leerChipsMedio(v)).toEqual(v);
  });

  it("descarta los mal formados (sin romper el resto)", () => {
    expect(
      leerChipsMedio([
        { texto: "Bien", tono: "exito" },
        { texto: "", tono: "info" },
        { texto: "   ", tono: "info" },
        { texto: "Tono raro", tono: "rojo" },
        { texto: 3, tono: "info" },
        null,
        "texto",
      ]),
    ).toEqual([{ texto: "Bien", tono: "exito" }]);
  });

  it("recorta el texto y descarta lo que trae HTML o pasa de 30 caracteres", () => {
    expect(leerChipsMedio([{ texto: "  Recomendado ", tono: "info" }])).toEqual([{ texto: "Recomendado", tono: "info" }]);
    expect(leerChipsMedio([{ texto: "<b>Oferta</b>", tono: "info" }])).toEqual([]);
    expect(leerChipsMedio([{ texto: "a".repeat(31), tono: "info" }])).toEqual([]);
  });

  it("muestra a lo sumo 3", () => {
    const seis = Array.from({ length: 6 }, (_, i) => ({ texto: `C${i}`, tono: "info" }));
    const r = leerChipsMedio(seis);
    expect(r).toHaveLength(MAX_CHIPS_MEDIO);
    expect(r.map((c) => c.texto)).toEqual(["C0", "C1", "C2"]);
  });
});

describe("tonoBadgeDeChip", () => {
  it("mapea cada tono al tono del Badge del DS", () => {
    expect(tonoBadgeDeChip("destacado")).toBe("warning");
    expect(tonoBadgeDeChip("exito")).toBe("success");
    expect(tonoBadgeDeChip("info")).toBe("info");
  });
});

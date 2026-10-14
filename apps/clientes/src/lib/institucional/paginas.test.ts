import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_PAGINA,
  PAGINAS_INSTITUCIONALES,
  claveDePagina,
  esSlugInstitucional,
  sanearPagina,
  validarPagina,
} from "./paginas";

describe("catálogo de páginas", () => {
  it("las 5 páginas, con clave pagina:<slug> y sin /envios-y-pagos", () => {
    expect(PAGINAS_INSTITUCIONALES.map((p) => p.slug)).toEqual([
      "preguntas-frecuentes",
      "garantia",
      "envios-y-devoluciones",
      "nosotros",
      "contacto",
    ]);
    expect(claveDePagina("garantia")).toBe("pagina:garantia");
    expect(esSlugInstitucional("envios-y-pagos")).toBe(false);
    expect(esSlugInstitucional("garantia")).toBe(true);
  });

  it("ningún slug choca con una ruta existente de src/app", () => {
    const app = fileURLToPath(new URL("../../app", import.meta.url));
    const existentes = readdirSync(app, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const { slug } of PAGINAS_INSTITUCIONALES) expect(existentes).not.toContain(slug);
  });
});

describe("sanearPagina (lectura estricta)", () => {
  it("basura => no publicada y sin bloques", () => {
    for (const raw of [undefined, null, 3, "x", [], { publicada: "si" }]) {
      expect(sanearPagina(raw)).toEqual({ publicada: false });
    }
  });

  it("publicada solo con true literal", () => {
    expect(sanearPagina({ publicada: true })).toEqual({ publicada: true });
    expect(sanearPagina({ publicada: 1 }).publicada).toBe(false);
  });

  it("quita marcado: nada de etiquetas ni de < >", () => {
    const p = sanearPagina({
      publicada: true,
      bloques: [{ titulo: "<b>Hola</b>", parrafos: ["<script>alert(1)</script>Texto <img src=x onerror=a()>", "a < b > c"] }],
    });
    const todo = JSON.stringify(p.bloques);
    expect(todo).not.toMatch(/[<>]/);
    expect(p.bloques?.[0].titulo).toBe("Hola");
    expect(p.bloques?.[0].parrafos[0]).toBe("alert(1)Texto");
  });

  it("descarta bloques vacíos y recorta largos y cantidades; no admite enlaces", () => {
    const p = sanearPagina({
      publicada: true,
      bloques: [
        { titulo: "", parrafos: ["a"] },
        { titulo: "Sin párrafos", parrafos: ["  ", ""] },
        { titulo: "x".repeat(MAX_PAGINA.titulo + 50), parrafos: ["y".repeat(MAX_PAGINA.parrafo + 50)], enlaces: [{ label: "a", href: "javascript:1" }] },
      ],
    });
    expect(p.bloques).toHaveLength(1);
    expect(p.bloques?.[0].titulo).toHaveLength(MAX_PAGINA.titulo);
    expect(p.bloques?.[0].parrafos[0]).toHaveLength(MAX_PAGINA.parrafo);
    expect(p.bloques?.[0]).not.toHaveProperty("enlaces");
    const muchos = sanearPagina({
      publicada: true,
      bloques: Array.from({ length: MAX_PAGINA.bloques + 5 }, (_, i) => ({ titulo: `B${i}`, parrafos: ["p"] })),
    });
    expect(muchos.bloques).toHaveLength(MAX_PAGINA.bloques);
  });

  it("bloques vacíos => sin bloques (cae al texto base)", () => {
    expect(sanearPagina({ publicada: true, bloques: [] })).toEqual({ publicada: true });
    expect(sanearPagina({ publicada: true, bloques: [{ titulo: "", parrafos: [] }] })).toEqual({ publicada: true });
  });
});

describe("validarPagina (escritura, errores en usted)", () => {
  it("acepta un payload correcto", () => {
    expect(validarPagina({ publicada: true, bloques: [{ titulo: "A", parrafos: ["b"] }] })).toEqual([]);
  });

  it("rechaza forma inválida y excesos con mensajes de usted", () => {
    const errores = [
      ...validarPagina(null),
      ...validarPagina({ publicada: "si" }),
      ...validarPagina({ publicada: true, bloques: [{ titulo: "x".repeat(MAX_PAGINA.titulo + 1), parrafos: ["a"] }] }),
      ...validarPagina({ publicada: true, bloques: [{ titulo: "A", parrafos: ["y".repeat(MAX_PAGINA.parrafo + 1)] }] }),
      ...validarPagina({ publicada: true, bloques: Array.from({ length: MAX_PAGINA.bloques + 1 }, () => ({ titulo: "A", parrafos: ["b"] })) }),
      ...validarPagina({ publicada: true, bloques: [{ titulo: "", parrafos: ["b"] }] }),
    ];
    expect(errores.length).toBeGreaterThanOrEqual(6);
    expect(errores.join(" ")).not.toMatch(/\b(tu|tus|te|vos)\b/i);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import { AVISO_ELEGIR_CATEGORIA, AVISO_ELEGIR_CATEGORIA_ESPECIFICA } from "@/lib/catalogo-vista";

/**
 * Registro formal (CLAUDE.md raíz) de los textos que suma el panel de facetas por tipo
 * (change catalogo-filtros-ux): el panel y sus avisos, sin voseo ni tuteo ni coloquialismos.
 */
const CARPETA = fileURLToPath(new URL(".", import.meta.url));

describe("panel de filtros por tipo: registro de usted", () => {
  it("sin voseo/tuteo ni coloquialismos en el panel y los chips", () => {
    const encontrados = ["CatalogoFiltros.tsx", "CatalogoChips.tsx"].flatMap((n) =>
      infracciones(readFileSync(join(CARPETA, n), "utf8"), REGISTRO).map((m) => `${n}:${m}`),
    );
    expect(encontrados, encontrados.join("\n")).toEqual([]);
  });

  it("los avisos del panel van en imperativo formal", () => {
    for (const aviso of [AVISO_ELEGIR_CATEGORIA, AVISO_ELEGIR_CATEGORIA_ESPECIFICA]) {
      expect(REGISTRO.test(aviso)).toBe(false);
      expect(aviso.startsWith("Elija ")).toBe(true);
    }
  });
});

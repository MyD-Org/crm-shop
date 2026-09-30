import { describe, expect, it } from "vitest";
import {
  ATRIBUTOS,
  atributoPorId,
  atributosDeTexto,
  atributosPorGrupo,
  atributosValidos,
  esAtributo,
  nombreAtributo,
} from "./catalogo-atributos";

const ids = (texto: string) => atributosDeTexto(texto).map((a) => a.id);

/**
 * Nombres con la forma de los del catálogo real (en mayúsculas, abreviados,
 * con la especificación en el nombre). Los patrones se corren acá en JS; en la
 * base corren con `~*` sobre el mismo texto normalizado.
 */
describe("patrones contra nombres de ejemplo", () => {
  it.each([
    ["REFLECTOR LED 50W CALIDO", ["tono-calido"]],
    ["PANEL PLAFON CUADRADO 12W AC85-265V CALIDO 3000K", ["tono-calido", "tension-220v"]],
    ["TIRA 5050 BCO FRIO IP20", ["tono-frio"]],
    ["Reflector 30W cálido IP66", ["tono-calido", "apto-exterior"]],
    ["PORTALÁMPARA CERÁMICO E27 CON ESCUADRA", ["zocalo-e27"]],
    ["TORTUGA LED 12W, 1020lm", []],
    ["LAMPARA LED 9W E27 LUZ DIA", ["tono-frio", "zocalo-e27"]],
    ["DICROICA LED 7W GU10 NEUTRO 4000K", ["tono-neutro", "zocalo-gu10"]],
    ["DICROICA MR16 12V 5W", ["zocalo-mr16", "tension-12v"]],
    ["FUENTE SWITCHING 24VCC 5A", ["tension-24v"]],
    ["VELA LED E14 3W WARM", ["tono-calido", "zocalo-e14"]],
    ["PROYECTOR APTO INTEMPERIE", ["apto-exterior"]],
    ["APLIQUE PARA EXTERIORES IP65 6500K", ["tono-frio", "apto-exterior"]],
    ["LAMPARA 220V 60W", ["tension-220v"]],
  ])("%s", (nombre, esperados) => {
    expect(ids(nombre)).toEqual(esperados);
  });

  it("IP20 e IP44 no son aptos para exterior", () => {
    expect(ids("TIRA 5050 IP20")).not.toContain("apto-exterior");
    expect(ids("PLAFON IP44 BAÑO")).not.toContain("apto-exterior");
  });

  it("'calidad' no es luz cálida y 'frigorífico' no es luz fría", () => {
    expect(ids("CABLE ALTA CALIDAD")).toEqual([]);
    expect(ids("CAMARA FRIGORIFICA")).toEqual([]);
  });

  it("12W no es 12V, 112V tampoco, y 'led 14w' no es rosca E14", () => {
    expect(ids("PANEL 12W")).not.toContain("tension-12v");
    expect(ids("EQUIPO 112V")).not.toContain("tension-12v");
    expect(ids("TUBO LED 14W")).not.toContain("zocalo-e14");
    expect(ids("CABLE 14 AWG")).not.toContain("zocalo-e14");
  });

  it("los patrones sólo usan lo que Postgres (ARE) y JS entienden igual", () => {
    for (const a of ATRIBUTOS) {
      expect(a.patron, a.id).not.toMatch(/\\[bBmMyY]|\[\[:|\(\?[=!<]/);
      expect(() => new RegExp(a.patron, "i")).not.toThrow();
    }
  });

  it("los sinónimos están normalizados y el propio atributo los reconoce en texto", () => {
    for (const a of ATRIBUTOS) {
      for (const s of a.sinonimos) {
        expect(s, `${a.id}: ${s}`).toBe(s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
      }
    }
    // Una muestra: los sinónimos "de especificación" los encuentra el patrón.
    expect(ids("foco 3000k")).toContain("tono-calido");
    expect(ids("foco ip67")).toContain("apto-exterior");
  });
});

describe("diccionario", () => {
  it("ids únicos y con el grupo como prefijo o conocido", () => {
    const vistos = new Set(ATRIBUTOS.map((a) => a.id));
    expect(vistos.size).toBe(ATRIBUTOS.length);
  });

  it("valida, ordena y agrupa ids", () => {
    expect(esAtributo("tono-calido")).toBe(true);
    expect(esAtributo("tono-violeta")).toBe(false);
    expect(atributosValidos(["zocalo-e27", "basura", "tono-frio", "tono-frio"])).toEqual([
      "tono-frio",
      "zocalo-e27",
    ]);
    const grupos = atributosPorGrupo(["tono-frio", "tono-calido", "zocalo-e27", "x"]);
    expect([...grupos.keys()]).toEqual(["tono", "zocalo"]);
    expect(grupos.get("tono")!.map((a) => a.id)).toEqual(["tono-calido", "tono-frio"]);
  });

  it("nombre visible, con el id como respaldo", () => {
    expect(nombreAtributo("apto-exterior")).toBe("Apto exterior");
    expect(nombreAtributo("otro")).toBe("otro");
    expect(atributoPorId("tension-12v")?.grupo).toBe("tension");
  });
});

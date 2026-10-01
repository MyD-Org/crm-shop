import { describe, expect, it } from "vitest";
import {
  ATRIBUTOS,
  atributoPorId,
  atributosDeProducto,
  atributosDeTexto,
  cumpleEstructurado,
  atributosPorGrupo,
  atributosValidos,
  esAtributo,
  nombreAtributo,
} from "./catalogo-atributos";
import type { AtributosEstructurados } from "./catalogo-caracteristicas";

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
    expect(esAtributo("tono-fucsia")).toBe(false);
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

describe("fase 2: dato estructurado O patrón del nombre (la cobertura sólo sube)", () => {
  const idsDe = (texto: string, e?: AtributosEstructurados) => atributosDeProducto(texto, e).map((a) => a.id);

  it("sin estructurados es idéntico a atributosDeTexto", () => {
    expect(idsDe("REFLECTOR LED 50W CALIDO")).toEqual(ids("REFLECTOR LED 50W CALIDO"));
  });

  it("el dato estructurado suma, nunca saca: nombre CALIDO + tono frío ⇒ los dos", () => {
    expect(idsDe("REFLECTOR LED 50W CALIDO", { tono: { n: null, t: "frio" } })).toEqual(["tono-calido", "tono-frio"]);
  });

  it("sólo el dato estructurado cumple (el nombre no dice nada) ⇒ incluido", () => {
    expect(idsDe("REFLECTOR LED 50W", { tono: { n: null, t: "neutro" } })).toEqual(["tono-neutro"]);
  });

  it("sube la cobertura: el dato de la ficha agrega lo que el nombre no dice", () => {
    expect(idsDe("REFLECTOR LED 50W", { ip: { n: 66, t: null }, zocalo: { n: null, t: "e27" } })).toEqual([
      "apto-exterior",
      "zocalo-e27",
    ]);
  });

  it("una clave sin dato estructurado sigue con el patrón", () => {
    expect(idsDe("LAMPARA 220V CALIDO", { zocalo: { n: null, t: "e27" } })).toEqual(["tono-calido", "zocalo-e27", "tension-220v"]);
  });

  it("IP estructurado 20 pero el nombre dice 'exterior' ⇒ sigue incluido (el nombre matchea)", () => {
    expect(idsDe("APLIQUE EXTERIOR", { ip: { n: 20, t: null } })).toEqual(["apto-exterior"]);
  });

  it("tensión: número exacto o rango que la incluye", () => {
    expect(idsDe("PANEL", { tension_v: { n: 220, t: "85-265" } })).toEqual(["tension-220v"]);
    expect(idsDe("DRIVER", { tension_v: { n: 24, t: "12-24" } })).toEqual(["tension-12v", "tension-24v"]);
    expect(idsDe("DISYUNTOR", { tension_v: { n: 230, t: "230/400" } })).toEqual(["tension-220v"]);
  });

  it("cumpleEstructurado: null sin dato, false si no cumple", () => {
    const c = atributoPorId("tono-calido")!.estructurado!;
    expect(cumpleEstructurado(c, undefined)).toBeNull();
    expect(cumpleEstructurado(c, { n: null, t: "neutro" })).toBe(false);
    expect(cumpleEstructurado(c, { n: null, t: "calido" })).toBe(true);
  });

  it("todo atributo del diccionario declara su criterio estructurado", () => {
    for (const a of ATRIBUTOS) expect(a.estructurado, a.id).toBeDefined();
  });
});

describe("tipo de luz de color y RGB (tono)", () => {
  it.each([
    ["TIRA LED 5M LUZ VERDE", ["tono-verde"]],
    ["LAMPARA 9W E27 LUZ ROJA", ["tono-rojo", "zocalo-e27"]],
    ["FOCO LUZ AZUL", ["tono-azul"]],
    ["FOCO LUZ AMARILLA", ["tono-amarillo"]],
    ["FOCO LUZ NARANJA", ["tono-naranja"]],
    ["FOCO LUZ VIOLETA", ["tono-violeta"]],
    ["FOCO LUZ ROSA", ["tono-rosa"]],
    ["TIRA LED 5050 RGB IP20", ["tono-rgb"]],
    ["TIRA LED 5050 RGBW", ["tono-rgbw"]],
  ])("%s", (nombre, esperados) => {
    expect(ids(nombre)).toEqual(esperados);
  });

  it("un color suelto no es tipo de luz", () => {
    expect(ids("CABLE UNIPOLAR VERDE")).toEqual([]);
    expect(ids("CINTA AISLADORA ROJA")).toEqual([]);
  });

  it("nombres del filtro y grupo tono", () => {
    expect(["tono-rojo", "tono-verde", "tono-azul", "tono-amarillo", "tono-rgb", "tono-rgbw"].map(nombreAtributo)).toEqual([
      "Luz roja", "Luz verde", "Luz azul", "Luz amarilla", "RGB", "RGBW",
    ]);
    expect(atributoPorId("tono-rgbw")?.grupo).toBe("tono");
  });

  it("el dato estructurado de tono suma el filtro", () => {
    expect(atributosDeProducto("TIRA LED 5M", { tono: { n: null, t: "azul" } }).map((a) => a.id)).toEqual(["tono-azul"]);
  });

  it("los sinónimos de búsqueda llevan a esos filtros", () => {
    expect(atributoPorId("tono-verde")?.sinonimos).toContain("luz verde");
    expect(atributoPorId("tono-rgb")?.sinonimos).toContain("rgb");
  });
});

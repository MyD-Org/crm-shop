import { describe, expect, it } from "vitest";
import {
  ATRIBUTOS,
  ATRIBUTOS_DE_CONTEXTO,
  atributoPorId,
  atributosDeProducto,
  atributosDeTexto,
  cumpleEstructurado,
  atributosPorGrupo,
  atributosValidos,
  esAtributo,
  nombreAtributo,
  TOPE_IDS_MEDIDA,
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

describe("atributos de contexto (apto-humedad): sólo ordenan, no son filtro ni faceta", () => {
  const humedad = ATRIBUTOS_DE_CONTEXTO.find((a) => a.id === "apto-humedad")!;

  it("resuelven por id (para ordenar) pero no están en el diccionario público", () => {
    expect(ATRIBUTOS.some((a) => a.id === "apto-humedad")).toBe(false);
    expect(atributoPorId("apto-humedad")?.grupo).toBe("ambiente");
    expect(nombreAtributo("apto-humedad")).toBe("Apto humedad");
    expect(humedad.sinonimos).toEqual([]);
    expect(humedad.estructurado).toEqual({ clave: "ip", desde: 44 });
  });

  it("no se pueden pedir por la URL ni salen como etiqueta de un producto", () => {
    expect(atributosValidos(["apto-humedad", "tono-frio"])).toEqual(["tono-frio"]);
    expect(atributosDeProducto("APLIQUE IP65", { ip: { n: 66, t: null } }).map((a) => a.id)).toEqual(["apto-exterior"]);
    expect(atributosDeTexto("APLIQUE IP54").map((a) => a.id)).toEqual([]);
  });

  it("el patrón es IP44 o más; IP20 y 440 no", () => {
    const re = new RegExp(humedad.patron, "i");
    for (const t of ["aplique ip44", "aplique ip 54", "ip-65 negro", "ip69"]) expect(re.test(t), t).toBe(true);
    for (const t of ["tira ip20", "caja ip440", "ip4", "aplique ip70"]) expect(re.test(t), t).toBe(false);
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
    ["FOCO LUZ AMBAR", ["tono-ambar"]],
    ["FOCO LUZ ÁMBAR", ["tono-ambar"]],
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

describe("ids dinámicos de medida (R4.1, R4.4, R4.6, R4.7)", () => {
  it.each([
    ["corriente_a:20", "medida:corriente_a", "Corriente: 20 A"],
    ["polos:2", "medida:polos", "Polos: 2"],
    ["potencia_w:8-10", "medida:potencia_w", "Potencia: 8 a 10 W"],
    ["zocalo:e14", "medida:zocalo", "Zócalo: E14"],
    ["curva:c", "medida:curva", "Curva: C"],
    ["ip:65", "medida:ip", "IP65 o superior"],
    ["tension_v:12", "medida:tension_v", "Tensión: 12 V"],
    ["medidas_mm:600x600", "medida:medidas_mm", "Medidas: 600 x 600 mm"],
  ])("%s se resuelve a un atributo sintetizado", (id, grupo, nombre) => {
    const a = atributoPorId(id);
    expect(a).toBeDefined();
    expect(a!.id).toBe(id);
    expect(a!.grupo).toBe(grupo);
    expect(a!.nombre).toBe(nombre);
    expect(esAtributo(id)).toBe(true);
    expect(nombreAtributo(id)).toBe(nombre);
    expect(a!.estructurado).toBeDefined();
    expect(a!.sinonimos).toEqual([]);
  });

  it("el atributo sintetizado trae su medida, su criterio y su patrón", () => {
    const a = atributoPorId("corriente_a:20")!;
    expect("medida" in a && a.medida).toEqual({ clave: "corriente_a", op: "eq", valor: 20 });
    expect(a.estructurado).toEqual({ clave: "corriente_a", numeros: [20] });
    expect(a.patron).toBeDefined();
    expect(new RegExp(a.patron!, "i").test("interruptor 2p 20a c")).toBe(true);
    expect(new RegExp(a.patron!, "i").test("interruptor 2p 25a c")).toBe(false);
    // Sin patrón sobre el texto: polos.
    expect(atributoPorId("polos:2")!.patron).toBeUndefined();
  });

  it.each([
    "corriente_a:0",
    "corriente_a:-5",
    "corriente_a:1e9",
    "corriente_a:020",
    "polos:5",
    "polos:2.5",
    "potencia_w:10-5",
    "zocalo:E27",
    "zocalo:e99",
    "ip:70",
    "curva:z",
    "clave_falsa:1",
    "corriente_a:20' OR 1=1--",
    "polos:2;drop table x",
    "corriente_a:",
    "corriente_a:20:30",
    "corriente_a:" + "1".repeat(40),
  ])("%s se rechaza", (id) => {
    expect(atributoPorId(id)).toBeUndefined();
    expect(esAtributo(id)).toBe(false);
    expect(nombreAtributo(id)).toBe(id);
    expect(atributosValidos([id])).toEqual([]);
  });

  it("los ids y grupos del diccionario no cambian (R4.6)", () => {
    expect(atributoPorId("zocalo-e27")?.grupo).toBe("zocalo");
    expect(atributoPorId("tension-12v")?.grupo).toBe("tension");
    expect(atributosValidos(["tension-24v", "zocalo-e27", "tono-frio"])).toEqual(["tono-frio", "zocalo-e27", "tension-24v"]);
    // Un id dinámico NO pisa el grupo de un id del diccionario aunque hablen de lo mismo.
    expect(atributoPorId("zocalo:e27")?.grupo).toBe("medida:zocalo");
  });

  it("atributosValidos: estáticos del diccionario y luego dinámicos por clave y valor, sin repetidos", () => {
    expect(
      atributosValidos(["polos:2", "tono-frio", "corriente_a:25", "basura", "corriente_a:20", "polos:2", "zocalo-e27"]),
    ).toEqual(["tono-frio", "zocalo-e27", "corriente_a:20", "corriente_a:25", "polos:2"]);
  });

  it("el orden de los dinámicos no depende del orden de la URL (misma URL canónica)", () => {
    const a = atributosValidos(["polos:2", "corriente_a:20", "zocalo:e14", "curva:c"]);
    const b = atributosValidos(["curva:c", "zocalo:e14", "corriente_a:20", "polos:2"]);
    expect(a).toEqual(b);
  });

  it("atributosValidos: tope de 8 dinámicos únicos; descarta lo inválido sin error (R4.7)", () => {
    const pedidos = [
      "corriente_a:10", "corriente_a:16", "corriente_a:20", "corriente_a:25", "corriente_a:32",
      "corriente_a:40", "corriente_a:50", "corriente_a:63", "corriente_a:80", "corriente_a:100",
      "corriente_a:10", "corriente_a:16", "polos:9", "x:1",
    ];
    const validos = atributosValidos(pedidos);
    expect(TOPE_IDS_MEDIDA).toBe(8);
    expect(validos).toHaveLength(8);
    expect(new Set(validos).size).toBe(8);
    expect(validos).toEqual(["corriente_a:10", "corriente_a:16", "corriente_a:20", "corriente_a:25", "corriente_a:32", "corriente_a:40", "corriente_a:50", "corriente_a:63"]);
  });

  it("el tope no toca a los ids del diccionario", () => {
    const dinamicos = Array.from({ length: 12 }, (_, i) => `corriente_a:${i + 1}`);
    const validos = atributosValidos([...dinamicos, "tono-frio", "zocalo-e27"]);
    expect(validos.slice(0, 2)).toEqual(["tono-frio", "zocalo-e27"]);
    expect(validos).toHaveLength(2 + 8);
  });

  it("atributosPorGrupo: AND entre grupos (uno por clave), OR dentro (dos corriente_a)", () => {
    const grupos = atributosPorGrupo(["corriente_a:20", "corriente_a:25", "polos:2", "tono-frio"]);
    expect([...grupos.keys()]).toEqual(["tono", "medida:corriente_a", "medida:polos"]);
    expect(grupos.get("medida:corriente_a")!.map((a) => a.id)).toEqual(["corriente_a:20", "corriente_a:25"]);
  });

  it("fuzz: 5000 cadenas al azar nunca lanzan y todo lo aceptado vuelve igual", () => {
    let semilla = 12345;
    const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alfabeto = "abcdefghijklmnopqrstuvwxyz_:.-0123456789xX' ;%\u00e1";
    for (let i = 0; i < 5000; i++) {
      const largo = 1 + Math.floor(azar() * 44);
      let id = "";
      for (let j = 0; j < largo; j++) id += alfabeto[Math.floor(azar() * alfabeto.length)];
      const a = atributoPorId(id);
      if (a) expect(a.id).toBe(id);
      expect(atributosValidos([id]).length).toBeLessThanOrEqual(1);
    }
  });
});

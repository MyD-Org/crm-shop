import { describe, expect, it } from "vitest";
import {
  TEXTO_SESGO,
  armarArchivo,
  desdeFila,
  filtrarPersonales,
  formatearResumen,
  mensajeSeguro,
  muestrear,
  parsearArgsExtraccion,
  resumirPoblacion,
  textoConsola,
  type ConsultaAgregada,
} from "./consultas-reales";

const c = (consulta: string, hits = 1, extra: Partial<ConsultaAgregada> = {}): ConsultaAgregada => ({
  consulta,
  hits,
  primera: "2026-09-01T10:00:00.000Z",
  ultima: "2026-09-20T10:00:00.000Z",
  fuentes: ["deterministico"],
  intencion: "producto",
  ...extra,
});

/** Consultas sintéticas distintas: "consulta sintetica 001"… con hits decrecientes. */
const poblacion = (n: number): ConsultaAgregada[] =>
  Array.from({ length: n }, (_, i) => c(`consulta sintetica ${String(i + 1).padStart(3, "0")}`, n - i));

describe("filtrarPersonales", () => {
  it("excluye email y 8 dígitos seguidos y cuenta cuántas", () => {
    const r = filtrarPersonales([c("lampara e27"), c("escriba a juan@cliente.example"), c("dni 12345678"), c("cable 2x1.5")]);
    expect(r.validas.map((x) => x.consulta)).toEqual(["lampara e27", "cable 2x1.5"]);
    expect(r.excluidas.datoPersonal).toBe(2);
  });

  it("no excluye un código de 5 dígitos", () => {
    const r = filtrarPersonales([c("12345")]);
    expect(r.validas).toHaveLength(1);
    expect(r.excluidas.datoPersonal).toBe(0);
  });

  it("descarta las vacías y las de más de 120 caracteres", () => {
    const r = filtrarPersonales([c("   "), c(""), c("a".repeat(121)), c("a".repeat(120))]);
    expect(r.validas).toHaveLength(1);
    expect(r.excluidas).toMatchObject({ vacia: 2, larga: 1, datoPersonal: 0 });
  });

  it("un teléfono con separadores también cuenta como dato personal", () => {
    const r = filtrarPersonales([c("+54 223 555-1234")]);
    expect(r.validas).toHaveLength(0);
    expect(r.excluidas.datoPersonal).toBe(1);
  });
});

describe("muestrear", () => {
  it("toma las top-N por hits y una cola sembrada del resto", () => {
    const m = muestrear(poblacion(40), { top: 10, cola: 5, semilla: 7 });
    expect(m.seleccion).toHaveLength(15);
    expect(m.seleccion.slice(0, 10).map((x) => x.consulta)).toEqual(poblacion(40).slice(0, 10).map((x) => x.consulta));
    const topNombres = new Set(m.seleccion.slice(0, 10).map((x) => x.consulta));
    for (const x of m.seleccion.slice(10)) expect(topNombres.has(x.consulta)).toBe(false);
    expect(m).toMatchObject({ nTotal: 40, nTop: 10, nCola: 5, semilla: 7 });
  });

  it("misma semilla => idéntico; otra semilla => otra cola", () => {
    const a = muestrear(poblacion(200), { top: 10, cola: 20, semilla: 42 });
    const b = muestrear(poblacion(200), { top: 10, cola: 20, semilla: 42 });
    const otra = muestrear(poblacion(200), { top: 10, cola: 20, semilla: 43 });
    expect(a).toEqual(b);
    expect(otra.seleccion.map((x) => x.consulta)).not.toEqual(a.seleccion.map((x) => x.consulta));
  });

  it("no depende del orden de entrada", () => {
    const base = poblacion(80);
    const invertida = [...base].reverse();
    expect(muestrear(invertida, { top: 5, cola: 10, semilla: 3 })).toEqual(muestrear(base, { top: 5, cola: 10, semilla: 3 }));
  });

  it("población menor que N: entra todo, la cola queda vacía y sin error", () => {
    const m = muestrear(poblacion(8), { top: 150, cola: 50, semilla: 1 });
    expect(m.seleccion).toHaveLength(8);
    expect(m).toMatchObject({ nTotal: 8, nTop: 8, nCola: 0 });
  });

  it("cola pedida mayor que lo que queda: toma lo que hay", () => {
    const m = muestrear(poblacion(12), { top: 10, cola: 50, semilla: 1 });
    expect(m.seleccion).toHaveLength(12);
    expect(m.nCola).toBe(2);
  });

  it("población vacía", () => {
    const m = muestrear([], { top: 10, cola: 5, semilla: 1 });
    expect(m.seleccion).toEqual([]);
    expect(m.nTotal).toBe(0);
  });
});

describe("resumirPoblacion", () => {
  const excluidas = { datoPersonal: 2, vacia: 0, larga: 1 };

  it("calcula los agregados de una población armada a mano", () => {
    const consultas = [
      c("alfa uno", 50, { fuentes: ["jev"], intencion: "producto" }),
      c("alfa dos", 30, { fuentes: ["jev", "deterministico"], intencion: "necesidad" }),
      c("alfa tres", 10, { fuentes: ["deterministico"], intencion: "producto" }),
      c("alfa cuatro", 5, { fuentes: ["deterministico"], intencion: null }),
      c("alfa cinco", 1, { fuentes: ["deterministico"], intencion: "pregunta", primera: "2026-08-01T00:00:00.000Z", ultima: "2026-09-25T00:00:00.000Z" }),
      c("alfa seis", 1, { fuentes: ["deterministico"], intencion: "producto" }),
    ];
    const r = resumirPoblacion(consultas, excluidas);
    expect(r.distintas).toBe(6);
    expect(r.totalHits).toBe(97);
    expect(r.unHit).toEqual({ n: 2, pct: (2 / 6) * 100 });
    // top 10 y top 50 cubren las 6 consultas: 100 % de los hits.
    expect(r.pctHitsTop10).toBeCloseTo(100);
    expect(r.pctHitsTop50).toBeCloseTo(100);
    // fuente: jev si alguna fila fue de Jev; suma 100 %.
    expect(r.fuentes.jev.n).toBe(2);
    expect(r.fuentes.deterministico.n).toBe(4);
    expect(r.intenciones.producto.n).toBe(3);
    expect(r.intenciones.necesidad.n).toBe(1);
    expect(r.intenciones.sin_dato.n).toBe(1);
    expect(r.fechas).toEqual({ desde: "2026-08-01T00:00:00.000Z", hasta: "2026-09-25T00:00:00.000Z" });
    expect(r.tenants).toBe(1);
    expect(r.excluidas).toEqual(excluidas);
  });

  it("el % de hits del top 10 refleja la concentración", () => {
    const r = resumirPoblacion([...poblacion(60).map((x, i) => ({ ...x, hits: i < 10 ? 100 : 1 }))], excluidas);
    // 10 * 100 de 1050 hits
    expect(r.pctHitsTop10).toBeCloseTo((1000 / 1050) * 100);
    expect(r.pctHitsTop50).toBeCloseTo((1040 / 1050) * 100);
  });

  it("longitudes: caracteres y palabras", () => {
    const r = resumirPoblacion([c("a"), c("dos palabras"), c("tres palabras aqui"), c("una dos tres cuatro cinco")], excluidas);
    expect(r.longitud.caracteres.max).toBe("una dos tres cuatro cinco".length);
    expect(r.longitud.palabras["1"]).toBe(1);
    expect(r.longitud.palabras["2"]).toBe(1);
    expect(r.longitud.palabras["3"]).toBe(1);
    expect(r.longitud.palabras["4+"]).toBe(1);
  });

  it("avisa si hay menos de 100 distintas", () => {
    expect(resumirPoblacion(poblacion(60), excluidas).avisos.join(" ")).toMatch(/menos de 100/);
    expect(resumirPoblacion(poblacion(120), excluidas).avisos.join(" ")).not.toMatch(/menos de 100/);
  });

  it("el zero-result real no está disponible y dice por qué", () => {
    const r = resumirPoblacion(poblacion(3), excluidas);
    expect(r.zeroResult.disponible).toBe(false);
    expect(r.zeroResult.motivo).toMatch(/plan/i);
  });

  it("una intención fuera del vocabulario cae en 'otra' (el texto del resumen nunca trae valores libres)", () => {
    const r = resumirPoblacion([c("x1", 1, { intencion: "texto-raro-del-jsonb" })], excluidas);
    expect(r.intenciones.otra.n).toBe(1);
    expect(JSON.stringify(r)).not.toContain("texto-raro-del-jsonb");
  });

  it("población vacía: sin NaN", () => {
    const r = resumirPoblacion([], excluidas);
    expect(r.distintas).toBe(0);
    expect(r.pctHitsTop10).toBe(0);
    expect(JSON.stringify(r)).not.toContain("null,\"pct\":NaN");
    expect(formatearResumen(r)).not.toMatch(/NaN/);
  });

  it("el texto incluye siempre el sesgo de población y ninguna consulta", () => {
    const consultas = [c("zeta secreta uno", 9), c("zeta secreta dos", 3)];
    const texto = formatearResumen(resumirPoblacion(consultas, excluidas));
    expect(texto).toContain(TEXTO_SESGO);
    expect(texto).not.toContain("zeta secreta");
    expect(formatearResumen(resumirPoblacion([], excluidas))).toContain(TEXTO_SESGO);
  });
});

describe("armarArchivo y textoConsola", () => {
  const consultas = [c("zeta secreta uno", 9), c("zeta secreta dos", 3), c("zeta secreta tres", 1)];
  const filtradas = filtrarPersonales(consultas);
  const muestra = muestrear(filtradas.validas, { top: 2, cola: 1, semilla: 5 });
  const resumen = resumirPoblacion(filtradas.validas, filtradas.excluidas);
  const archivo = armarArchivo({ extraidoEl: "2026-10-05T12:00:00.000Z", categorias: ["Categoria A", "Categoria B"], muestra, resumen });

  it("el archivo trae las consultas, las categorías y los parámetros del muestreo", () => {
    expect(archivo.esquema).toBe(1);
    expect(archivo.categorias).toEqual(["Categoria A", "Categoria B"]);
    expect(archivo.muestreo).toEqual({ top: 2, cola: 1, semilla: 5, nTotal: 3 });
    expect(archivo.consultas.map((x) => x.consulta)).toContain("zeta secreta uno");
  });

  it("no contiene variables de entorno ni identificadores del tenant", () => {
    const json = JSON.stringify(archivo);
    expect(json).not.toMatch(/SHOP_TENANT_ID|DATABASE_URL|postgres:\/\//i);
    expect(Object.keys(archivo)).not.toContain("tenant");
    expect(Object.keys(archivo)).not.toContain("tenantId");
  });

  it("la consulta sólo está en el archivo: la consola trae conteos, ruta y duración", () => {
    const texto = textoConsola({ resumen, muestra, ruta: "/ruta/ignorada/consultas-reales.local.json", ms: 1234 });
    expect(texto).not.toContain("zeta secreta");
    expect(texto).toContain("/ruta/ignorada/consultas-reales.local.json");
    expect(texto).toMatch(/1\.2 s|1234 ms/);
    expect(texto).toContain(TEXTO_SESGO);
  });
});

describe("desdeFila", () => {
  it("normaliza una fila del SELECT agregado (fuentes en texto, fechas como texto o Date, hits como número o texto)", () => {
    expect(
      desdeFila({ consulta: "lampara e27", hits: "7", primera: "2026-09-01 10:00:00+00", ultima: new Date("2026-09-20T10:00:00.000Z"), fuentes: "jev,deterministico", intencion: "producto" }),
    ).toEqual({
      consulta: "lampara e27",
      hits: 7,
      primera: "2026-09-01T10:00:00.000Z",
      ultima: "2026-09-20T10:00:00.000Z",
      fuentes: ["deterministico", "jev"],
      intencion: "producto",
    });
  });

  it("tolera nulos y fechas ilegibles", () => {
    expect(desdeFila({ consulta: "x", hits: 1, primera: null, ultima: "no es una fecha", fuentes: null, intencion: null })).toEqual({
      consulta: "x",
      hits: 1,
      primera: null,
      ultima: null,
      fuentes: [],
      intencion: null,
    });
  });
});

describe("parsearArgsExtraccion", () => {
  it("defaults: top 150, cola 50, semilla 1, ruta bajo tmp/ y consultas ocultas", () => {
    expect(parsearArgsExtraccion([])).toEqual({ top: 150, cola: 50, semilla: 1, salida: "tmp/busqueda/consultas-reales.local.json", verConsultas: false });
  });

  it("acepta los flags", () => {
    expect(parsearArgsExtraccion(["--top=80", "--cola=0", "--semilla=9", "--salida=/fuera/del/repo.json", "--ver-consultas"])).toEqual({
      top: 80,
      cola: 0,
      semilla: 9,
      salida: "/fuera/del/repo.json",
      verConsultas: true,
    });
  });

  it("rechaza enteros inválidos y flags desconocidos (un typo no corre con los defaults)", () => {
    expect(() => parsearArgsExtraccion(["--top=-1"])).toThrow(/--top/);
    expect(() => parsearArgsExtraccion(["--cola=abc"])).toThrow(/--cola/);
    expect(() => parsearArgsExtraccion(["--tpo=10"])).toThrow(/desconocido/i);
  });
});

describe("mensajeSeguro", () => {
  it("un error de conexión no deja pasar la cadena de conexión ni la contraseña", () => {
    const err = Object.assign(new Error("password authentication failed for postgres://shop_app:s3cr3t-placeholder@db.cliente.example:5432/shop"), { code: "28P01" });
    const m = mensajeSeguro(err);
    expect(m).not.toContain("s3cr3t-placeholder");
    expect(m).not.toContain("db.cliente.example");
    expect(m).toContain("28P01");
  });

  it("conserva el aviso propio de variable faltante (no trae valores)", () => {
    expect(mensajeSeguro(new Error("Falta SHOP_TENANT_ID en el entorno. El Shop no opera sin tenant."))).toMatch(/Falta SHOP_TENANT_ID/);
    expect(mensajeSeguro(new Error("Falta DATABASE_URL en el entorno (rol shop_app)."))).toMatch(/Falta DATABASE_URL/);
  });

  it("algo que no es un Error", () => {
    expect(mensajeSeguro("boom")).toMatch(/desconocido/);
  });
});

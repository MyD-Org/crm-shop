import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATRIBUTOS } from "@/lib/catalogo-atributos";
import { CLAVES_ESTRUCTURADAS, TIPO } from "@/lib/catalogo-caracteristicas";
import type { FilaUniverso } from "@/lib/busqueda-v2/__banco__/universo";
import atributosClaves from "@/db/__fixtures__/atributos-claves.json";
import contrato from "@/db/__fixtures__/crm-contrato.json";
import {
  calcularCobertura,
  clavesUsadasHoy,
  type FilaAtributo,
} from "./cobertura";

const fila = (id: string, p: Partial<FilaUniverso> = {}): FilaUniverso => ({
  alegraId: id,
  activo: true,
  tieneOverlay: true,
  visible: true,
  categoriaId: "c-lamparas",
  conStock: true,
  conPrecio: true,
  ...p,
});

const atr = (alegraId: string, clave: string, valorNum: string | null, valorTexto: string | null = null): FilaAtributo => ({
  alegraId,
  clave,
  valorNum,
  valorTexto,
});

/** Árbol: Iluminación (Lámparas, Reflectores), Electricidad (Cables), Vacía (sin productos). */
const ARBOL = [
  { id: "c-ilum", parentId: null, nombre: "Iluminación", orden: 1 },
  { id: "c-lamparas", parentId: "c-ilum", nombre: "Lámparas", orden: 1 },
  { id: "c-reflectores", parentId: "c-ilum", nombre: "Reflectores", orden: 2 },
  { id: "c-elec", parentId: null, nombre: "Electricidad", orden: 2 },
  { id: "c-cables", parentId: "c-elec", nombre: "Cables", orden: 1 },
  { id: "c-vacia", parentId: null, nombre: "Vacía", orden: 3 },
];

/** 10 en Iluminación (4 en Lámparas, 3 en Reflectores, 3 asignados a la raíz), 2 en Cables, 3 sin categoría, 1 inactiva. */
function fixture(): FilaUniverso[] {
  return [
    ...["l1", "l2", "l3", "l4"].map((id) => fila(id, { categoriaId: "c-lamparas" })),
    ...["r1", "r2", "r3"].map((id) => fila(id, { categoriaId: "c-reflectores" })),
    ...["i1", "i2", "i3"].map((id) => fila(id, { categoriaId: "c-ilum" })),
    ...["k1", "k2"].map((id) => fila(id, { categoriaId: "c-cables" })),
    ...["s1", "s2", "s3"].map((id) => fila(id, { categoriaId: null })),
    fila("x1", { categoriaId: "c-borrada" }),
  ];
}

const CLAVES = CLAVES_ESTRUCTURADAS;

describe("calcularCobertura: universo y denominador", () => {
  it("el denominador son los publicados con stock; los inactivos, sin stock o sin precio no cuentan", () => {
    const filas = [
      fila("a"),
      fila("b", { conStock: false }),
      fila("c", { visible: false }),
      fila("d", { conPrecio: false }),
      fila("e", { activo: false }),
    ];
    const c = calcularCobertura(filas, [atr("e", "potencia_w", "9")], ARBOL, { universo: "publicados" });
    expect(c.global.productos).toBe(1);
    expect(c.global.claves.potencia_w).toEqual({ n: 0, pct: 0 }); // el inactivo no suma aunque tenga dato
    expect(c.resumen.activos).toBe(4);
  });

  it("--universo=activos: activos con stock, visibles o no", () => {
    const filas = [fila("a"), fila("b", { visible: false }), fila("c", { conStock: false }), fila("d", { activo: false })];
    const c = calcularCobertura(filas, [], ARBOL, { universo: "activos" });
    expect(c.global.productos).toBe(2);
    const p = calcularCobertura(filas, [], ARBOL, { universo: "publicados" });
    expect(p.global.productos).toBe(1);
  });
});

describe("calcularCobertura: conteo por producto distinto", () => {
  it("un producto con dos filas de la misma clave cuenta una sola vez, y varias claves cuentan en cada una", () => {
    const filas = [fila("a"), fila("b")];
    const atributos = [
      atr("a", "potencia_w", "9"),
      atr("a", "potencia_w", "12"), // repetida (imposible por PK, simulada)
      atr("a", "ip", "65"),
      atr("b", "ip", "20"),
    ];
    const c = calcularCobertura(filas, atributos, ARBOL, { universo: "publicados" });
    expect(c.global.claves.potencia_w).toEqual({ n: 1, pct: 50 });
    expect(c.global.claves.ip).toEqual({ n: 2, pct: 100 });
  });
});

describe("calcularCobertura: categoría raíz vs directa", () => {
  const c = calcularCobertura(
    fixture(),
    [atr("l1", "potencia_w", "9"), atr("l2", "potencia_w", "12"), atr("k1", "potencia_w", "5")],
    ARBOL,
    { universo: "publicados" },
  );

  it("la raíz suma a todo lo que cuelga de ella; la categoría directa, sólo lo asignado", () => {
    const raiz = c.raices.find((g) => g.id === "c-ilum")!;
    const hoja = c.categorias.find((g) => g.id === "c-lamparas")!;
    expect(raiz.productos).toBe(10);
    expect(hoja.productos).toBe(4);
    expect(raiz.claves.potencia_w).toEqual({ n: 2, pct: 20 });
    expect(hoja.claves.potencia_w).toEqual({ n: 2, pct: 50 });
  });

  it("una raíz sin productos queda con n=0 y 0 % (sin NaN)", () => {
    const vacia = c.raices.find((g) => g.id === "c-vacia")!;
    expect(vacia.productos).toBe(0);
    for (const k of CLAVES) {
      expect(vacia.claves[k]).toEqual({ n: 0, pct: 0 });
    }
    expect(vacia.sinAtributos).toBe(0);
  });

  it("las categorías directas sólo listan las que tienen productos", () => {
    expect(c.categorias.map((g) => g.id).sort()).toEqual(["c-cables", "c-ilum", "c-lamparas", "c-reflectores"]);
  });

  it("'sin categoría' es un grupo explícito y no se pierde del global", () => {
    expect(c.sinCategoria.productos).toBe(3);
    expect(c.global.productos).toBe(16);
    expect(c.raices.reduce((s, g) => s + g.productos, 0) + c.sinCategoria.productos + c.inactivas.productos).toBe(16);
  });

  it("una categoría inactiva o desconocida cae en su propio grupo", () => {
    expect(c.inactivas.productos).toBe(1);
  });

  it("una categoría cuyo padre está inactivo (fuera del árbol activo) también es 'inactiva o desconocida'", () => {
    const arbol = [...ARBOL, { id: "c-huerfana", parentId: "c-padre-inactivo", nombre: "Huérfana", orden: 9 }];
    const r = calcularCobertura([fila("h1", { categoriaId: "c-huerfana" })], [], arbol, { universo: "publicados" });
    expect(r.inactivas.productos).toBe(1);
    expect(r.raices.every((g) => g.productos === 0)).toBe(true);
  });

  it("un ciclo en el árbol no cuelga el cálculo", () => {
    const arbol = [
      { id: "a", parentId: "b", nombre: "A", orden: 1 },
      { id: "b", parentId: "a", nombre: "B", orden: 1 },
    ];
    const r = calcularCobertura([fila("z", { categoriaId: "a" })], [], arbol, { universo: "publicados" });
    expect(r.inactivas.productos).toBe(1);
  });
});

describe("calcularCobertura: las claves siempre son columnas", () => {
  it("las 25 claves aparecen en el global y en cada grupo, incluidas las de 0 %", () => {
    const c = calcularCobertura([fila("a")], [atr("a", "ip", "65")], ARBOL, { universo: "publicados" });
    expect(CLAVES).toHaveLength(25);
    expect(Object.keys(c.global.claves)).toEqual([...CLAVES]);
    expect(c.global.claves.leds_rollo).toEqual({ n: 0, pct: 0 });
    expect(c.porClave.map((f) => f.clave)).toEqual([...CLAVES]);
    for (const g of [...c.raices, ...c.categorias]) expect(Object.keys(g.claves)).toEqual([...CLAVES]);
  });

  it("sin productos en el universo no hay NaN en ninguna parte", () => {
    const c = calcularCobertura([], [], ARBOL, { universo: "publicados" });
    expect(c.global.productos).toBe(0);
    expect(JSON.stringify(c)).not.toMatch(/NaN|null.*Infinity/);
    expect(c.global.claves.ip.pct).toBe(0);
  });

  it("filas con una clave que el Shop no conoce se cuentan aparte y no suman a ninguna columna", () => {
    const c = calcularCobertura([fila("a")], [atr("a", "clave_nueva", "1"), atr("a", "ip", "65")], ARBOL, { universo: "publicados" });
    expect(c.clavesDesconocidas).toBe(1);
    expect(Object.keys(c.global.claves)).not.toContain("clave_nueva");
  });
});

describe("calcularCobertura: productos sin atributos", () => {
  it("6 productos con stock sin ninguna fila: 6 en el global y 6 en su raíz", () => {
    const filas = ["a", "b", "c", "d", "e", "f"].map((id) => fila(id, { categoriaId: "c-cables" }));
    const c = calcularCobertura([...filas, fila("g", { categoriaId: "c-cables" })], [atr("g", "ip", "65")], ARBOL, { universo: "publicados" });
    expect(c.global.sinAtributos).toBe(6);
    expect(c.raices.find((g) => g.id === "c-elec")!.sinAtributos).toBe(6);
    expect(c.raices.find((g) => g.id === "c-ilum")!.sinAtributos).toBe(0);
  });

  it("un producto con sólo una clave desconocida cuenta como sin atributos", () => {
    const c = calcularCobertura([fila("a")], [atr("a", "clave_nueva", "1")], ARBOL, { universo: "publicados" });
    expect(c.global.sinAtributos).toBe(1);
  });
});

describe("calcularCobertura: distribución por clave", () => {
  const filas = ["a", "b", "c", "d", "e"].map((id) => fila(id));
  const c = calcularCobertura(
    filas,
    [
      atr("a", "potencia_w", "5"),
      atr("b", "potencia_w", "9.00"),
      atr("c", "potencia_w", "9"),
      atr("d", "potencia_w", "12"),
      atr("e", "potencia_w", "100"),
    ],
    ARBOL,
    { universo: "publicados" },
  );

  it("numérica: min, mediana, max, top valor y distintos", () => {
    const d = c.distribucion.potencia_w;
    expect(d.tipo).toBe("num");
    expect(d.num).toEqual({ min: 5, mediana: 9, max: 100 });
    expect(d.top[0]).toEqual({ valor: "9", n: 2 });
    expect(d.distintos).toBe(4);
  });

  it("mediana con cantidad par: promedio de los dos centrales", () => {
    const r = calcularCobertura(
      [fila("a"), fila("b")],
      [atr("a", "potencia_w", "10"), atr("b", "potencia_w", "20")],
      ARBOL,
      { universo: "publicados" },
    );
    expect(r.distribucion.potencia_w.num?.mediana).toBe(15);
  });

  it("textual: top 10 con conteos y cantidad de distintos", () => {
    const productos = Array.from({ length: 14 }, (_, i) => fila(`t${i}`));
    const atributos = productos.map((f, i) => atr(f.alegraId, "zocalo", null, i < 3 ? "e27" : `z${i}`));
    const r = calcularCobertura(productos, atributos, ARBOL, { universo: "publicados" });
    const d = r.distribucion.zocalo;
    expect(d.tipo).toBe("texto");
    expect(d.top).toHaveLength(10);
    expect(d.top[0]).toEqual({ valor: "e27", n: 3 });
    expect(d.distintos).toBe(12);
    expect(d.num).toBeUndefined();
  });

  it("una clave sin valores tiene distribución vacía, sin NaN", () => {
    expect(c.distribucion.ip).toEqual({ tipo: "num", n: 0, distintos: 0, top: [] });
  });

  it("no contiene nombres de producto ni ids", () => {
    const json = JSON.stringify(c);
    for (const id of ["a", "b", "c", "d", "e"]) expect(json).not.toContain(`"alegraId":"${id}"`);
    expect(Object.keys(c.global)).not.toContain("alegraId");
  });

  it("sólo cuentan los valores de productos del universo", () => {
    const r = calcularCobertura([fila("a")], [atr("a", "potencia_w", "7"), atr("zzz", "potencia_w", "99")], ARBOL, { universo: "publicados" });
    expect(r.distribucion.potencia_w.num).toEqual({ min: 7, mediana: 7, max: 7 });
  });
});

describe("claves usadas hoy por la búsqueda", () => {
  const usadas = clavesUsadasHoy();

  it("se derivan del diccionario ATRIBUTOS más la potencia del filtro", () => {
    const esperado = new Set<string>(["potencia_w"]);
    for (const a of ATRIBUTOS) if (a.estructurado) esperado.add(a.estructurado.clave);
    expect(new Set(usadas)).toEqual(esperado);
  });

  it("son tono, ip, zocalo, tension_v y potencia_w", () => {
    expect([...usadas].sort()).toEqual(["ip", "potencia_w", "tension_v", "tono", "zocalo"]);
  });

  it("el reporte las marca 'usada hoy' y las otras 18 'no usada', con su cobertura", () => {
    const c = calcularCobertura([fila("a")], [atr("a", "polos", "2")], ARBOL, { universo: "publicados" });
    const si = c.porClave.filter((f) => f.usadaHoy).map((f) => f.clave).sort();
    expect(si).toEqual(["ip", "potencia_w", "tension_v", "tono", "zocalo"]);
    const no = c.porClave.filter((f) => !f.usadaHoy);
    expect(no).toHaveLength(20);
    expect(no.find((f) => f.clave === "polos")).toMatchObject({ n: 1, pct: 100, tipo: "num" });
  });

  it("deriva: toda clave que la capa de catálogo consulta por nombre está en la lista de usadas hoy", () => {
    // Si alguien agrega un filtro por otra clave en catalog.ts y no la suma a `clavesUsadasHoy`, falla.
    const fuente = readFileSync(new URL("../src/lib/catalog.ts", import.meta.url), "utf8");
    const literales = new Set<string>();
    for (const m of fuente.matchAll(/filaAtributoSql\(\s*["']([a-z_0-9]+)["']/g)) literales.add(m[1]);
    for (const m of fuente.matchAll(/clave\}\s*=\s*'([a-z_0-9]+)'/g)) literales.add(m[1]);
    // Guarda de la guarda: si el patrón dejara de encontrar la potencia, el test no estaría vigilando nada.
    expect(literales.has("potencia_w")).toBe(true);
    for (const clave of literales) {
      expect(usadas.has(clave as never), `la clave "${clave}" se usa en catalog.ts pero no está en clavesUsadasHoy`).toBe(true);
    }
  });

  it("deriva: no hay claves usadas que no existan en las 25", () => {
    for (const k of usadas) expect((CLAVES as readonly string[]).includes(k)).toBe(true);
  });
});

describe("las 25 claves salen del código del Shop, no de una lista propia", () => {
  it("coinciden con el fixture compartido con el CRM (claves y tipos)", () => {
    expect([...CLAVES]).toEqual(atributosClaves.claves);
    expect(TIPO).toEqual(atributosClaves.tipos);
  });

  it("el contrato de columnas del CRM cubre las que lee la cobertura de catalog_atributos", () => {
    const columnas = Object.keys((contrato as Record<string, Record<string, string>>)["public.catalog_atributos"]);
    for (const c of ["tenant_id", "alegra_id", "clave", "valor_num", "valor_texto"]) expect(columnas).toContain(c);
    // `fuente` no está concedida al rol del Shop: la cobertura no la lee (límite declarado en el reporte).
    expect(columnas).not.toContain("fuente");
  });

  it("la cobertura usa exactamente las claves de CLAVES_ESTRUCTURADAS", () => {
    const c = calcularCobertura([], [], ARBOL, { universo: "publicados" });
    expect(c.claves).toEqual([...CLAVES_ESTRUCTURADAS]);
  });
});

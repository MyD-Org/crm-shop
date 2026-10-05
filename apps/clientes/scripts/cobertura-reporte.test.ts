import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { CLAVES_ESTRUCTURADAS } from "@/lib/catalogo-caracteristicas";
import type { FilaUniverso } from "@/lib/busqueda-v2/__banco__/universo";
import {
  LIMITES,
  armarReporte,
  calcularCobertura,
  generarCobertura,
  parsearArgsCobertura,
  type CabeceraCobertura,
  type FilaAtributo,
} from "./cobertura";

const fila = (id: string, p: Partial<FilaUniverso> = {}): FilaUniverso => ({
  alegraId: id,
  activo: true,
  tieneOverlay: true,
  visible: true,
  categoriaId: "c1",
  conStock: true,
  conPrecio: true,
  ...p,
});
const atr = (alegraId: string, clave: string, valorNum: string | null, valorTexto: string | null = null): FilaAtributo => ({ alegraId, clave, valorNum, valorTexto });

const ARBOL = [
  { id: "c1", parentId: null, nombre: "Iluminación", orden: 1 },
  { id: "c2", parentId: "c1", nombre: "Lámparas", orden: 1 },
];

const cabecera = (p: Partial<CabeceraCobertura> = {}): CabeceraCobertura => ({
  fecha: "2026-10-05T12:00:00.000Z",
  gitSha: "abc1234",
  sucio: false,
  tenantAlias: "shop",
  universo: "publicados",
  duracionMs: 1234,
  ...p,
});

const filas = [fila("a", { categoriaId: "c2" }), fila("b", { categoriaId: "c2" }), fila("c", { categoriaId: null }), fila("d", { conStock: false })];
const atributos = [atr("a", "potencia_w", "9"), atr("a", "tono", null, "calido"), atr("b", "potencia_w", "12"), atr("a", "polos", "2")];
const cobertura = calcularCobertura(filas, atributos, ARBOL, { universo: "publicados" });
const reporte = () => armarReporte({ cabecera: cabecera(), resumen: cobertura.resumen, cobertura });

describe("armarReporte", () => {
  it("el JSON es válido y trae todas las secciones", () => {
    const { json } = reporte();
    const vuelta = JSON.parse(JSON.stringify(json));
    expect(vuelta).toEqual(json);
    expect(Object.keys(json)).toEqual(["esquema", "cabecera", "universo", "cobertura", "limites"]);
    const c = json.cobertura as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(["global", "porClave", "matrizPorRaiz", "matrizPorCategoria", "sinCategoria", "categoriaInactivaODesconocida", "sinAtributos", "distribucion", "clavesUsadasHoy", "clavesDesconocidas"]);
    expect(json.esquema).toBe(1);
  });

  it("la cabecera lleva fecha, sha, alias de tenant, universo y duración", () => {
    const { json, texto } = reporte();
    expect(json.cabecera).toEqual(cabecera());
    expect(texto).toContain("2026-10-05T12:00:00.000Z");
    expect(texto).toContain("abc1234");
    expect(texto).toContain("shop");
    expect(texto).toMatch(/1[.,]2 ?s|1234 ?ms/);
  });

  it("marca el árbol sucio en la cabecera", () => {
    expect(armarReporte({ cabecera: cabecera({ sucio: true }), resumen: cobertura.resumen, cobertura }).texto).toContain("abc1234 (sucio)");
  });

  it("las 21 claves están en el encabezado de la matriz, incluidas las de 0 %", () => {
    const { texto, json } = reporte();
    const encabezado = texto.split("\n").find((l) => l.startsWith("| Categoría raíz"))!;
    expect(encabezado).toBeDefined();
    for (const k of CLAVES_ESTRUCTURADAS) expect(encabezado).toContain(k);
    const c = json.cobertura as { global: { claves: Record<string, unknown> } };
    expect(Object.keys(c.global.claves)).toEqual([...CLAVES_ESTRUCTURADAS]);
  });

  it("marca las claves 'usada hoy' y 'no usada' con su cobertura", () => {
    const { texto } = reporte();
    const fila = (k: string) => texto.split("\n").find((l) => l.startsWith(`| ${k} |`))!;
    expect(fila("tono")).toContain("usada hoy");
    expect(fila("potencia_w")).toContain("usada hoy");
    expect(fila("polos")).toContain("no usada");
    expect(fila("polos")).toContain("33.3"); // 1 de 3
  });

  it("declara los límites: no se desglosa por fuente y por qué", () => {
    const { texto, json } = reporte();
    expect(LIMITES.join(" ")).toMatch(/fuente/);
    expect(LIMITES.join(" ")).toMatch(/shop_app|rol del Shop/);
    expect(texto).toContain(LIMITES[0]);
    expect(json.limites).toEqual(LIMITES);
  });

  it("explica la definición del universo y el denominador", () => {
    const { texto } = reporte();
    expect(texto).toMatch(/publicados.+stock/i);
    expect(texto).toContain("Productos activos");
  });

  describe("no filtra secretos ni ids", () => {
    const previo = { url: process.env.DATABASE_URL, tenant: process.env.SHOP_TENANT_ID };
    afterEach(() => {
      if (previo.url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo.url;
      if (previo.tenant === undefined) delete process.env.SHOP_TENANT_ID;
      else process.env.SHOP_TENANT_ID = previo.tenant;
    });

    it("ni variables de entorno, ni cadenas de conexión, ni el id del tenant, ni ids de producto", () => {
      process.env.DATABASE_URL = "postgres://usuario:s3cr3t-placeholder@db.example:5432/shop";
      process.env.SHOP_TENANT_ID = "tenant-id-real-de-ejemplo";
      const { texto, json } = reporte();
      const todo = texto + JSON.stringify(json);
      expect(todo).not.toContain("s3cr3t-placeholder");
      expect(todo).not.toContain("postgres://");
      expect(todo).not.toContain("DATABASE_URL");
      expect(todo).not.toContain("tenant-id-real-de-ejemplo");
      expect(todo).not.toMatch(/alegraId|alegra_id/);
    });
  });

  it("si la tabla de atributos no está disponible, informa el motivo y no inventa coberturas", () => {
    const { texto, json } = armarReporte({
      cabecera: cabecera(),
      resumen: cobertura.resumen,
      cobertura: { no_disponible: "no se pudo leer catalog_atributos (error)" },
    });
    expect(json.cobertura).toEqual({ no_disponible: "no se pudo leer catalog_atributos (error)" });
    expect(texto).toContain("no se pudo leer catalog_atributos");
    expect(texto).not.toContain("| Categoría raíz");
    expect(json.universo.activos).toBe(cobertura.resumen.activos);
  });
});

describe("parsearArgsCobertura", () => {
  it("por defecto: universo publicados, alias 'shop', sin JSON", () => {
    expect(parsearArgsCobertura([])).toEqual({ universo: "publicados", tenantAlias: "shop" });
  });

  it("--json=<ruta> y su alias --salida", () => {
    expect(parsearArgsCobertura(["--json=tmp/busqueda/cobertura.json"]).json).toBe("tmp/busqueda/cobertura.json");
    expect(parsearArgsCobertura(["--salida=tmp/c.json"]).json).toBe("tmp/c.json");
  });

  it("--universo=activos y --tenant-alias", () => {
    expect(parsearArgsCobertura(["--universo=activos", "--tenant-alias=demo"])).toEqual({ universo: "activos", tenantAlias: "demo" });
  });

  it("falla ante valores inválidos o flags desconocidos, con mensaje claro", () => {
    expect(() => parsearArgsCobertura(["--universo=todos"])).toThrow(/publicados\|activos/);
    expect(() => parsearArgsCobertura(["--nada"])).toThrow(/desconocido/i);
    expect(() => parsearArgsCobertura(["--json"])).toThrow(/ruta/);
  });
});

describe("script registrado", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };

  it("existe busqueda:cobertura con el entorno de .env.local opcional", () => {
    expect(pkg.scripts["busqueda:cobertura"]).toBe("tsx --env-file-if-exists=.env.local scripts/cobertura-atributos.ts");
    expect(existsSync(new URL("./cobertura-atributos.ts", import.meta.url))).toBe(true);
  });

  it("no hay package.json ni lockfile en la raíz del monorepo", () => {
    for (const f of ["package.json", "package-lock.json"]) {
      expect(existsSync(new URL(`../../../${f}`, import.meta.url))).toBe(false);
    }
  });
});

describe("generarCobertura (orquestación con lectura inyectada)", () => {
  const git = () => ({ sha: "abc1234", sucio: false });
  const reloj = (...t: number[]) => {
    let i = 0;
    return () => t[Math.min(i++, t.length - 1)];
  };

  it("arma el reporte con la duración medida, el alias y el universo pedidos", async () => {
    const r = await generarCobertura(
      { universo: "activos", tenantAlias: "demo" },
      { leer: async () => ({ filas, arbol: ARBOL, atributos }), git, ahora: reloj(1_000, 3_500) },
    );
    expect(r.json.cabecera).toMatchObject({ tenantAlias: "demo", universo: "activos", duracionMs: 2_500, gitSha: "abc1234", sucio: false });
    expect(r.texto).toContain("2.5 s");
    expect((r.json.cobertura as { global: { productos: number } }).global.productos).toBe(3);
  });

  it("si los atributos no están disponibles, el universo igual se informa y la cobertura queda no_disponible", async () => {
    const r = await generarCobertura(
      { universo: "publicados", tenantAlias: "shop" },
      { leer: async () => ({ filas, arbol: ARBOL, atributos: { no_disponible: "no se pudo leer catalog_atributos (PostgresError)" } }), git },
    );
    expect(r.json.universo.activos).toBe(4);
    expect(r.json.cobertura).toEqual({ no_disponible: "no se pudo leer catalog_atributos (PostgresError)" });
  });

  it("no lee nada hasta que se la llama y propaga el error de la lectura", async () => {
    await expect(
      generarCobertura({ universo: "publicados", tenantAlias: "shop" }, { leer: async () => Promise.reject(new Error("falló")), git }),
    ).rejects.toThrow("falló");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashBanco, parsearBanco } from "@/lib/busqueda-v2/__banco__/cargar-banco";
import { compilarBancoReal, textoCompilacion } from "./compilar-banco-real";

const CATEGORIAS = ["Categoria A", "Categoria B", "Categoria C"];

type Estado = "propuesto" | "revisado" | "descartado" | "pendiente";
const caso = (i: number, etiquetado: Estado | undefined, extra: Record<string, unknown> = {}) => ({
  q: `consulta sintetica ${i}`,
  perfil: "desconocido",
  categoria: ["Categoria A"],
  debeIncluirEnTop24: [`palabra${i}`],
  ...(etiquetado ? { etiquetado } : {}),
  ...extra,
});
const propuestas = (items: unknown[]) => ({ version: 1, busquedas: items });

describe("compilarBancoReal", () => {
  it("de 120 propuestas (100 revisadas, 15 descartadas, 5 propuestas) compila exactamente las 100 revisadas", () => {
    const items = [
      ...Array.from({ length: 100 }, (_, i) => caso(i, "revisado")),
      ...Array.from({ length: 15 }, (_, i) => caso(100 + i, "descartado")),
      ...Array.from({ length: 5 }, (_, i) => caso(115 + i, "propuesto")),
    ];
    const { banco, resumen } = compilarBancoReal(propuestas(items), CATEGORIAS);
    expect(banco.busquedas).toHaveLength(100);
    expect(banco.busquedas.every((b) => b.etiquetado === "revisado")).toBe(true);
    expect(resumen).toMatchObject({ total: 120, revisadas: 100, descartadas: 15, propuestas: 5, pendientes: 0, menorA100: false });
  });

  it("un caso SIN estado no cuenta como revisado (sólo lo marca la usuaria)", () => {
    const { banco, resumen } = compilarBancoReal(propuestas([caso(1, undefined), caso(2, "revisado")]), CATEGORIAS);
    expect(banco.busquedas).toHaveLength(1);
    expect(resumen.sinEstado).toBe(1);
  });

  it("una categoría inexistente en un caso revisado falla con el índice y sin el texto de la consulta", () => {
    const items = [caso(0, "revisado"), caso(1, "revisado", { categoria: ["Categoria Fantasma"], q: "texto secreto de la consulta" })];
    let mensaje = "";
    try {
      compilarBancoReal(propuestas(items), CATEGORIAS);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toMatch(/caso #1/);
    expect(mensaje).toMatch(/categoria/);
    expect(mensaje).not.toContain("texto secreto");
    expect(mensaje).not.toContain("Categoria Fantasma");
  });

  it("también valida categoriaEnTop24", () => {
    const items = [caso(0, "revisado", { categoria: undefined, categoriaEnTop24: ["Otra inexistente"] })];
    expect(() => compilarBancoReal(propuestas(items), CATEGORIAS)).toThrow(/caso #0.*categoriaEnTop24/);
  });

  it("una categoría inexistente en un caso descartado no bloquea", () => {
    const { banco } = compilarBancoReal(propuestas([caso(0, "revisado"), caso(1, "descartado", { categoria: ["No existe"] })]), CATEGORIAS);
    expect(banco.busquedas).toHaveLength(1);
  });

  it("menos de 100 revisadas: compila todas y declara 'n < 100' con el motivo", () => {
    const items = Array.from({ length: 60 }, (_, i) => caso(i, "revisado"));
    const { banco, resumen } = compilarBancoReal(propuestas(items), CATEGORIAS);
    expect(banco.busquedas).toHaveLength(60);
    expect(resumen.menorA100).toBe(true);
    expect(resumen.motivo).toMatch(/n < 100/);
    expect(textoCompilacion(resumen)).toMatch(/n < 100/);
  });

  it("sin ninguna revisada falla: no se emite un banco vacío", () => {
    expect(() => compilarBancoReal(propuestas([caso(0, "propuesto")]), CATEGORIAS)).toThrow(/ninguna|revisad/i);
  });

  it("esquema inválido: error con índice y campo, sin imprimir la consulta", () => {
    const items = [{ perfil: "particular", etiquetado: "revisado" }, caso(1, "revisado", { q: "texto secreto" })];
    let mensaje = "";
    try {
      compilarBancoReal(propuestas(items), CATEGORIAS);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toMatch(/caso #0/);
    expect(mensaje).not.toContain("texto secreto");
  });

  it("la salida es un banco real y privado que carga con parsearBanco", () => {
    const { banco } = compilarBancoReal(propuestas([caso(0, "revisado", { peso: 12, tipo: "typo" }), caso(1, "revisado")]), CATEGORIAS);
    expect(banco).toMatchObject({ version: 1, origen: "real", privado: true, categorias: CATEGORIAS });
    // Ida y vuelta por JSON, como lo lee `--banco`.
    const cargado = parsearBanco(JSON.parse(JSON.stringify(banco)), { origen: "local" });
    expect(cargado.privado).toBe(true);
    expect(cargado.casos).toHaveLength(2);
    expect(cargado.casos[0]).toMatchObject({ peso: 12, tipo: "typo", etiquetado: "revisado" });
    expect(hashBanco(cargado.casos)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("avisa (sólo conteos) de los casos revisados sin ninguna expectativa", () => {
    const { resumen } = compilarBancoReal(propuestas([caso(0, "revisado", { categoria: undefined, debeIncluirEnTop24: undefined }), caso(1, "revisado")]), CATEGORIAS);
    expect(resumen.avisos.join(" ")).toMatch(/1 caso/);
    expect(resumen.avisos.join(" ")).not.toContain("consulta sintetica");
  });

  it("el texto de la compilación sólo trae conteos", () => {
    const { resumen } = compilarBancoReal(propuestas([caso(0, "revisado", { q: "texto secreto" })]), CATEGORIAS);
    expect(textoCompilacion(resumen)).not.toContain("texto secreto");
  });
});

describe("ejemplo de propuestas versionado", () => {
  it("compila con las categorías del propio ejemplo (guarda del formato que usa el etiquetado)", () => {
    const ruta = fileURLToPath(new URL("../src/lib/busqueda-v2/__banco__/banco-propuestas.ejemplo.json", import.meta.url));
    const json = JSON.parse(readFileSync(ruta, "utf8")) as { categorias: string[] };
    const { banco, resumen } = compilarBancoReal(json, json.categorias);
    expect(banco.busquedas.length).toBeGreaterThan(0);
    expect(resumen.descartadas + resumen.propuestas).toBeGreaterThan(0);
  });
});

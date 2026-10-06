import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Test de arquitectura del motor único de búsqueda: el texto de una búsqueda lo arma SÓLO el motor
 * (`busqueda-v2/motor.ts`). Las superficies (página del catálogo, autocompletar, chat, selector del
 * admin, `/buscar`) llaman a `buscarEnShop`/`contarConsulta` y no a la capa del catálogo con
 * `busqueda`/`busquedaTolerante`/`planBusqueda` armados a mano: cada copia propia era una copia más
 * del reintento tolerante.
 *
 * La lista de excepciones se achica cuando se retiran los campos viejos de `FiltrosCatalogo`.
 */
const SRC = join(__dirname, "..");

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : archivos(ruta);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

/** Sin comentarios ni literales de texto: sólo el código. */
function codigo(ruta: string): string {
  return readFileSync(ruta, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

const rel = (ruta: string) => relative(SRC, ruta).split(sep).join("/");

/** Quien PUEDE hablar con la capa del catálogo con texto: ella misma, la caché pública, el conteo de Entender, el cableado del motor, el parser de la URL y el banco. */
const PERMITIDOS = [
  /^lib\/catalog\.ts$/,
  /^lib\/catalogo-publico\.ts$/,
  /^lib\/catalogo-url\.ts$/,
  /^lib\/busqueda-v2\/conteo\.ts$/,
  /^lib\/busqueda-v2\/motor-servidor\.ts$/,
  /^lib\/busqueda-v2\/__banco__\//,
];

const LECTURAS_DEL_CATALOGO = /\b(getCatalogo|getPaginaCatalogo|contarCatalogo|paginaCatalogoPublica)\b/;
const CAMPOS_DE_TEXTO = /\b(busqueda|busquedaTolerante|planBusqueda|tolerante)\s*:/;

describe("el texto de la búsqueda sólo lo arma el motor", () => {
  const todos = archivos(SRC).map((ruta) => ({ ruta, nombre: rel(ruta) }));
  const fuera = todos.filter(({ nombre }) => !PERMITIDOS.some((re) => re.test(nombre)));

  it("hay archivos que mirar (el test no es vacuo)", () => {
    expect(todos.length).toBeGreaterThan(100);
    expect(fuera.length).toBeGreaterThan(50);
  });

  it("fuera de la lista de excepciones nadie llama a las lecturas del catálogo con texto", () => {
    const infractores = fuera.filter(({ ruta }) => LECTURAS_DEL_CATALOGO.test(codigo(ruta))).map(({ nombre }) => nombre);
    expect(infractores).toEqual([]);
  });

  it("ni la página, ni las rutas, ni el selector del admin arman `busqueda`/`tolerante`/`planBusqueda`", () => {
    const superficies = todos.filter(({ nombre }) => nombre.startsWith("app/") || nombre === "lib/home-acciones.ts");
    expect(superficies.length).toBeGreaterThan(20);
    const infractores = superficies.filter(({ ruta }) => CAMPOS_DE_TEXTO.test(codigo(ruta))).map(({ nombre }) => nombre);
    expect(infractores).toEqual([]);
  });

  it("el motor existe y las cinco entradas lo usan", () => {
    const usan = [
      "app/catalogo/page.tsx",
      "app/api/shop/catalogo/route.ts",
      "app/api/chat-ia/buscar/route.ts",
      "lib/home-acciones.ts",
    ];
    for (const nombre of usan) expect(codigo(join(SRC, nombre)), nombre).toMatch(/\bbuscarEnShop\b/);
    expect(codigo(join(SRC, "app/buscar/route.ts"))).toMatch(/\bcontarConsulta\b/);
  });
});

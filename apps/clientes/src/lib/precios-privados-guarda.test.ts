import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda del precio por usuario (change `listas-cuenta-corriente`): un precio de lista privada nunca
 * puede entrar en una caché compartida (`'use cache'`, incluido `'use cache: remote'` del catálogo).
 * Se vigila por código: ningún módulo con la directiva importa la lectura de precios privados ni la
 * resolución de la lista del comprador, y sólo los módulos de la lista blanca los usan.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const PROHIBIDOS = /from\s+["'][^"']*(?:precios-privados-repo|lista-cuenta-repo)["']|\bcrmPreciosPrivados\b|\bcrmListaMapeo\b/;

/** Los únicos que pueden leer precios privados o resolver la lista del comprador. */
const LISTA_BLANCA = new Set([
  "lib/cotizacion.ts",
  "lib/carrito-db.ts",
  "lib/carrito-compartido-datos.ts",
  "lib/lista-cuenta-repo.ts",
  "lib/precios-privados-repo.ts",
  "db/crm.ts",
  "app/api/precios-cuenta/route.ts",
  "app/api/carrito/route.ts",
  "app/api/carrito/cotizar/route.ts",
  "app/api/pedidos/route.ts",
  "app/api/pedidos/[id]/medio/route.ts",
  "app/api/chat-ia/productos/route.ts",
]);

const todos = archivos(SRC).map((p) => ({ ruta: relative(SRC, p), texto: readFileSync(p, "utf8") }));

describe("precios privados: nunca en una caché compartida", () => {
  it("ningún módulo con 'use cache' toca precios privados ni la lista del comprador", () => {
    const conCache = todos.filter((f) => /^\s*['"]use cache(?::\s*\w+)?['"]/m.test(f.texto));
    expect(conCache.length).toBeGreaterThan(0);
    for (const f of conCache) expect(f.texto, f.ruta).not.toMatch(PROHIBIDOS);
  });

  it("sólo la lista blanca importa la lectura privada o la resolución de la lista", () => {
    const usan = todos.filter((f) => PROHIBIDOS.test(f.texto)).map((f) => f.ruta);
    const fuera = usan.filter((r) => !LISTA_BLANCA.has(r));
    expect(fuera).toEqual([]);
  });

  it("el catálogo público y su caché no mencionan la lista privada", () => {
    for (const ruta of ["lib/catalog.ts", "lib/catalogo-publico.ts", "lib/catalogo-medios.ts"]) {
      const f = todos.find((x) => x.ruta === ruta);
      if (f) expect(f.texto, ruta).not.toMatch(/precios_online_privados|listaPrivada|crmPreciosPrivados/);
    }
  });
});

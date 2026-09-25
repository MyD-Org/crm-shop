import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas estáticas de las cachés (Cache Components). Lo que rompen se ve
 * recién en producción: un precio viejo en el carrito, datos de un visitante
 * en una caché compartida o un aviso del CRM que no invalida nada.
 */
const SRC = __dirname;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__fixtures__" ? [] : archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const CODIGO = archivos(SRC).map((ruta) => ({
  ruta: relative(SRC, ruta),
  src: readFileSync(ruta, "utf8"),
}));

/** Sólo directivas reales (una línea que es la directiva), no menciones en comentarios. */
const DIRECTIVA = /^\s*["']use cache(?::\s*(?:remote|private))?["'];?\s*$/m;

/**
 * Los únicos módulos con scopes cacheados. Todo lo que se sirve a cualquier
 * visitante y nada del visitante: contenido de la home, año del footer, el
 * catálogo público, la oferta de cuotas para exhibir y los archivos de la
 * imagen OG del sitio.
 */
const CON_CACHE = [
  "app/opengraph-image.tsx",
  "lib/home-datos.ts",
  "components/SiteFooter.tsx",
  "lib/catalogo-publico.ts",
  "lib/cuotas-datos.ts",
];

/** Lo que cotiza o cobra: siempre del espejo en vivo (FRS-4). */
const SIN_CACHE = /^(app\/carrito\/|app\/mi-cuenta\/|app\/api\/carrito\/|app\/api\/pedidos\/|app\/checkout\/|app\/api\/pagos\/|lib\/cotizacion\.ts$|lib\/carrito-precios\.ts$|lib\/pedidos\.ts$|components\/CheckoutClient\.tsx$)/;

describe("guardas de caché", () => {
  it("no queda ningún `force-dynamic` (con Cache Components se usa Suspense/connection)", () => {
    const con = CODIGO.filter((a) => a.src.includes("force-dynamic")).map((a) => a.ruta);
    expect(con).toEqual([]);
  });

  it("`'use cache'` sólo en los módulos permitidos", () => {
    const con = CODIGO.filter((a) => DIRECTIVA.test(a.src)).map((a) => a.ruta).sort();
    expect(con).toEqual([...CON_CACHE].sort());
  });

  it("revalidateTag siempre con perfil (el de un argumento está deprecado)", () => {
    for (const { ruta, src } of CODIGO) {
      for (const m of src.matchAll(/\brevalidateTag\(([^()]*)\)/g)) {
        expect(m[1], `${ruta}: revalidateTag(${m[1]})`).toContain(",");
      }
    }
  });

  it("carrito, cotización, checkout y pedidos no leen de las cachés compartidas", () => {
    const cotizan = CODIGO.filter((a) => SIN_CACHE.test(a.ruta));
    expect(cotizan.length).toBeGreaterThan(5);
    for (const { ruta, src } of cotizan) {
      expect(src, ruta).not.toMatch(/catalogo-publico/);
      expect(src, ruta).not.toMatch(/ofertaCuotasCacheada|getOfertaCuotas\(/);
    }
  });

  it("las funciones cacheadas no evalúan flags ni leen el request (van como argumento)", () => {
    for (const ruta of ["lib/catalogo-publico.ts", "lib/catalog.ts"]) {
      const src = CODIGO.find((a) => a.ruta === ruta)!.src;
      expect(src, ruta).not.toMatch(/from "@\/flags"|-flag"|flags-publicos|next\/headers|identidadActual|esAdmin/);
    }
  });
});

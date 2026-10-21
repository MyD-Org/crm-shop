import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El header va en el shell estático. Con dos cachés esperadas una DESPUÉS de la otra, la segunda
 * llegaba tarde al shell y Next marcaba la home como bloqueante ("Uncached data or `connection()`
 * was accessed outside of `<Suspense>`", en Header y en SiteFooter). Se leen en paralelo.
 */
describe("Header en el shell estático", () => {
  it("lee el contenido de la home y las páginas de marca en paralelo", () => {
    const src = readFileSync(join(__dirname, "HeaderServer.tsx"), "utf8");
    expect(src).toMatch(/Promise\.all\(\[getContenidoHome\(\), getPaginasMarca\(\)\]\)/);
    expect(src).not.toMatch(/await getPaginasMarca\(\)/);
  });
});

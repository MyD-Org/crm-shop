import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMA_COOKIE } from "./tema-ip";
import { CLAVE_CACHE, CLAVE_CACHE_V1 } from "./carrito-cliente";

/**
 * Guarda de fuente (patrón de `credenciales.test.ts`): el nombre de Central Led no puede aparecer
 * suelto en el código del Shop. Sus textos viven en `MARCA_POR_DEFECTO` (marca-base.ts) y salen por
 * `getMarca()`; una tienda con marca propia (change `shop-para-avantec`) jamás debe mostrar el de
 * otra. Los comentarios no cuentan. Para sumar una excepción hay que justificarla acá.
 */
const SRC = join(__dirname, "..");

const NOMBRE_CENTRAL = /central\s?led|centralled|central-led/i;

/** Archivos que pueden nombrar a Central, y por qué. */
const PERMITIDOS: Record<string, string> = {
  "lib/marca-base.ts": "los textos de partida de Central (MARCA_POR_DEFECTO): fuente única",
  "app/opengraph-image.tsx": "`alt` debe ser un literal (Next lo lee en el build): no puede derivar de la marca",
  "data/footer.ts": "DEFAULTS_FOOTER: el pie de Central (la base genérica usa defaultsFooterDe)",
  "components/HeaderUI.tsx": "el logo SVG de código de Central (assets/central-led-logo.svg)",
  "components/home/hero-lights.ts": "fotos del hero interactivo de Central (public/images/central-led/)",
  "components/home/editores/EditorHero.tsx": "texto alternativo de la foto del estudio de Central (sólo se ofrece con base central)",
  "lib/chat-ia-textos.ts": "ruta del avatar del chat (public/images/central-led/); el chat está apagado fuera de Central",
  "lib/vinculacion-mail.ts": "ruta del logo de mail de Central (RUTA_LOGO_MAIL); otra marca usa su logoMailUrl o nada",
  "lib/tema-ip.ts": "clave de la cookie de tema: NO cambia (preferencias de los clientes de Central)",
  "lib/carrito-cliente.ts": "claves del carrito en localStorage: NO cambian (carritos de los clientes de Central)",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__fixtures__" ? [] : archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Sin comentarios de bloque ni de línea (los de línea sólo si arrancan la línea o siguen a un espacio). */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("el nombre de Central Led no está suelto en el código", () => {
  const codigo = archivos(SRC).map((ruta) => ({
    ruta: relative(SRC, ruta).split("\\").join("/"),
    src: sinComentarios(readFileSync(ruta, "utf8")),
  }));

  it("sólo lo nombran los archivos de la lista, y toda entrada de la lista sigue haciéndolo", () => {
    const nombran = codigo.filter((a) => NOMBRE_CENTRAL.test(a.src)).map((a) => a.ruta).sort();
    expect(nombran).toEqual(Object.keys(PERMITIDOS).sort());
  });

  it("las rutas del código que usan la marca la piden a getMarca/MARCA_POR_DEFECTO (no repiten el literal)", () => {
    for (const ruta of [
      "app/manifest.ts",
      "app/layout.tsx",
      "lib/sitio-jsonld.ts",
      "lib/email.ts",
      "lib/vinculacion.ts",
      "lib/pagos/cobrar.ts",
      "lib/pagos/mercadopago-preferencia.ts",
      "app/api/geocode/route.ts",
      "components/VincularClient.tsx",
      "components/SiteFooter.tsx",
      "components/VisorFotos.tsx",
      "proxy.ts",
      "app/global-error.tsx",
    ]) {
      const a = codigo.find((c) => c.ruta === ruta);
      expect(a, ruta).toBeDefined();
      expect(NOMBRE_CENTRAL.test(a!.src), ruta).toBe(false);
    }
  });
});

describe("claves de cookie y localStorage: no cambian (el carrito y el tema de Central se conservan)", () => {
  // Cada tienda es su propio origen; el runbook de alta prohíbe que compartan COOKIE_DOMAIN.
  it("tema y carrito", () => {
    expect(TEMA_COOKIE).toBe("centralled-tema");
    expect(CLAVE_CACHE).toBe("centralled.carrito.v2");
    expect(CLAVE_CACHE_V1).toBe("centralled.carrito.v1");
  });
});

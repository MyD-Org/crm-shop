import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guardas ESTÁTICAS de la rebanada A de `home-editable`: no leen jsdom (no
 * hay), leen el código fuente como texto. Cubren los escenarios de la spec
 * "La prop llega desde el servidor" y "El endpoint deja de existir" /
 * "RUTAS_PUBLICAS conserva los otros dos".
 */

const PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));
const HOME_CLIENT = fileURLToPath(new URL("../components/HomeClient.tsx", import.meta.url));
const PROXY = fileURLToPath(new URL("../proxy.ts", import.meta.url));
const HOME_CONTENT_DIR = fileURLToPath(new URL("./api/internal/home-content", import.meta.url));

const EDICION_SI_ADMIN = fileURLToPath(new URL("../components/home/EdicionSiAdmin.tsx", import.meta.url));
const SECCION_EDITABLE = fileURLToPath(new URL("../components/home/SeccionEditable.tsx", import.meta.url));
const PAGINA_LEGAL = fileURLToPath(new URL("../components/legales/PaginaLegal.tsx", import.meta.url));
const BOTON_LEGAL_SI_ADMIN = fileURLToPath(
  new URL("../components/legales/BotonDatosLegalesSiAdmin.tsx", import.meta.url),
);
const PAGINAS_LEGALES = ["terminos", "privacidad", "envios-y-pagos", "arrepentimiento"].map((r) =>
  fileURLToPath(new URL(`./${r}/page.tsx`, import.meta.url)),
);

/** El código sin comentarios: los comentarios pueden nombrar `esAdmin()`. */
function codigo(ruta: string): string {
  return readFileSync(ruta, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * performance-mobile-shop 4a: la home no calcula `esAdmin()` (antes lo hacía y
 * pasaba `puedeEditar` a HomeClient). El permiso lo resuelve el hueco
 * `EdicionSiAdmin` dentro de un Suspense, y el modo edición llega por contexto.
 */
describe("home-editable A (4a): el permiso de edición lo resuelve un hueco aparte", () => {
  it("page.tsx NO llama esAdmin() y monta EdicionSiAdmin dentro de <Suspense>", () => {
    const texto = codigo(PAGE);
    expect(texto).not.toContain("esAdmin");
    expect(texto).not.toContain("puedeEditar");
    expect(texto).toMatch(/<HomeClient/);
    expect(texto).toMatch(/<ModoEdicionProvider>/);
    expect(texto).toMatch(/<Suspense fallback=\{null\}>\s*<EdicionSiAdmin/);
  });

  it("EdicionSiAdmin sí llama esAdmin() y es server (sin \"use client\")", () => {
    const texto = readFileSync(EDICION_SI_ADMIN, "utf8");
    expect(texto).toContain("esAdmin()");
    expect(texto).toContain("<HabilitarEdicion");
    expect(texto).toContain("<BarraEdicion");
    expect(texto).not.toContain('"use client"');
  });

  it("HomeClient y SeccionEditable no reciben puedeEditar ni inicial por props", () => {
    const home = codigo(HOME_CLIENT);
    expect(home).not.toContain("puedeEditar");
    expect(home).not.toMatch(/inicial=/);
    const seccion = codigo(SECCION_EDITABLE);
    expect(seccion).toMatch(/const \{ puedeEditar, activo \} = useModoEdicion\(\)/);
    expect(seccion).not.toMatch(/inicial/);
  });

  it("HomeClient.tsx sigue siendo un server component (sin \"use client\")", () => {
    const texto = readFileSync(HOME_CLIENT, "utf8");
    expect(texto).not.toContain('"use client"');
  });
});

describe("páginas legales (4a): el botón de edición es un hueco aparte", () => {
  it("ninguna página legal llama esAdmin() ni pasa puedeEditar", () => {
    for (const ruta of PAGINAS_LEGALES) {
      const texto = codigo(ruta);
      expect(texto, ruta).not.toContain("esAdmin");
      expect(texto, ruta).not.toContain("puedeEditar");
    }
  });

  it("PaginaLegal monta BotonDatosLegalesSiAdmin dentro de <Suspense>, que sí llama esAdmin()", () => {
    expect(readFileSync(PAGINA_LEGAL, "utf8")).toMatch(/<Suspense fallback=\{null\}>\s*<BotonDatosLegalesSiAdmin/);
    expect(readFileSync(BOTON_LEGAL_SI_ADMIN, "utf8")).toContain("esAdmin()");
  });
});

describe("home-editable B1: whatsapp sale del contrato, no de literales", () => {
  it("HomeClient.tsx no hardcodea el href ni el copy del CTA de WhatsApp", () => {
    const texto = readFileSync(HOME_CLIENT, "utf8");
    expect(texto).not.toContain("https://wa.me/");
    expect(texto).not.toContain("¿Necesitás asesoramiento");
  });
});

describe("home-editable B2: las 8 secciones de HomeClient están envueltas en SeccionEditable", () => {
  it("HomeClient.tsx tiene 8 <SeccionEditable", () => {
    const texto = readFileSync(HOME_CLIENT, "utf8");
    const ocurrencias = texto.match(/<SeccionEditable/g) ?? [];
    expect(ocurrencias).toHaveLength(8);
  });
});

describe("home-editable A: PUT /api/internal/home-content eliminado", () => {
  it("el endpoint deja de existir", () => {
    expect(existsSync(HOME_CONTENT_DIR)).toBe(false);
  });

  it("RUTAS_PUBLICAS conserva los otros dos y no el de home-content", () => {
    const texto = readFileSync(PROXY, "utf8");
    expect(texto).toContain("/api/pagos/mercadopago/webhook");
    expect(texto).toContain("/api/internal/catalogo/revalidar");
    expect(texto).not.toContain("/api/internal/home-content");
  });
});

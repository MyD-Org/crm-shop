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

describe("home-editable A: puedeEditar llega desde el servidor", () => {
  it("page.tsx calcula esAdmin() y pasa puedeEditar a HomeClient", () => {
    const texto = readFileSync(PAGE, "utf8");
    expect(texto).toContain("esAdmin()");
    expect(texto).toContain("puedeEditar");
    expect(texto).toMatch(/<HomeClient/);
  });

  it("HomeClient.tsx sigue siendo un server component (sin \"use client\")", () => {
    const texto = readFileSync(HOME_CLIENT, "utf8");
    expect(texto).not.toContain('"use client"');
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

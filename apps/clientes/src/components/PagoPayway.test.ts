import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guardas a nivel de código fuente (sin montar React; el proyecto de unit tests corre en `node`) del
 * formulario de tarjeta de Payway: lo que NO puede pasar con el número y el código de seguridad.
 */

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
const componente = leer("./PagoPayway.tsx");
const checkout = leer("./CheckoutClient.tsx");
const modulos = [
  componente,
  leer("../lib/pagos/payway-tarjeta.ts"),
  leer("../lib/pagos/payway-token.ts"),
  leer("../lib/pagos/payway-cobro-cliente.ts"),
  leer("../lib/pagos/payway-sdk-navegador.ts"),
];

describe("PagoPayway: datos de tarjeta", () => {
  it("ningún módulo del formulario loguea ni guarda datos de forma persistente", () => {
    for (const fuente of modulos) {
      const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      // console.error sólo con textos fijos y el estado HTTP: nada interpola pan/cvv/solicitud.
      for (const linea of sinComentarios.split("\n").filter((l) => /console\./.test(l))) {
        // Se descartan los textos fijos: sólo importa qué variables se interpolan o pasan.
        const sinTextos = linea.replace(/"[^"]*"|`[^`]*`/g, '""');
        expect(sinTextos, linea).not.toMatch(/\b(pan|cvv|solicitud|campos|montado|cuerpo|token|respuesta|r)\b/);
      }
      expect(sinComentarios).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|sendBeacon|gtag\(|fbq\(|posthog/);
    }
  });

  it("borra el número y el código de seguridad en cuanto obtiene el token", () => {
    const i = componente.indexOf("const token = await tokenizar(");
    const j = componente.indexOf("await enviarCobro(");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    const entre = componente.slice(i, j);
    expect(entre).toContain('setPan("")');
    expect(entre).toContain('setCvv("")');
  });

  it("el formulario no envía nada a nuestro servidor por sí mismo (sin action ni fetch con la tarjeta)", () => {
    expect(componente).not.toMatch(/<form[^>]*\baction=/);
    // El único fetch directo del componente es el de la configuración pública.
    const fetches = componente.match(/fetch\(([^)]*)\)/g) ?? [];
    expect(fetches).toEqual(['fetch("/api/pagos/payway-config")']);
  });

  it("usa autocomplete de tarjeta y teclado numérico (móvil)", () => {
    for (const a of ["cc-number", "cc-exp", "cc-csc", "cc-name"]) expect(componente).toContain(`autoComplete="${a}"`);
    expect(componente).toContain('inputMode="numeric"');
  });
});

describe("CheckoutClient", () => {
  it("monta PagoPayway para el procesador payway y conserva el de Mercado Pago", () => {
    expect(checkout).toMatch(/confirmado\.procesador === "payway"[\s\S]*<PagoPayway/);
    expect(checkout).toMatch(/confirmado\.procesador === "mercadopago"[\s\S]*<PagoMercadoPago/);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { modalidadesPaywayHabilitadas } from "./pago-opciones";

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

describe("PagoPayway: cuotas en el formulario (rebanada 5 de cuotas-en-el-formulario)", () => {
  const sinComentarios = componente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("las cuotas ya no son una prop congelada ni 'Elegidas en el carrito'", () => {
    expect(sinComentarios).not.toMatch(/\bcuotas\s*=\s*1\s*,/);
    expect(sinComentarios).not.toContain("Elegidas en el carrito");
    expect(sinComentarios).not.toContain("Vuelva al carrito y elija 1 cuota");
  });

  it("pide las opciones al servidor con la marca detectada o elegida (no hay BIN antes de tokenizar)", () => {
    expect(sinComentarios).toMatch(/useOpcionesCuotas\(\s*pedidoId,\s*\{\s*marca:/);
  });

  it("el desplegable es el mismo de Mercado Pago, sólo en crédito (débito: 1 pago, sin desplegable)", () => {
    expect(sinComentarios).toMatch(/eleccionPayway\(/);
    expect(sinComentarios).toMatch(/conSelector\s*&&[\s\S]*<SelectorCuotas/);
    expect(sinComentarios).toContain('const PROCESADOR = "Payway"');
  });

  it("deja el pedido en las cuotas elegidas ANTES de tokenizar (el token es de un solo uso) y cobra esas", () => {
    const i = sinComentarios.indexOf("asegurarCuotasDelPedido(");
    const j = sinComentarios.indexOf("await tokenizar(");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(sinComentarios).toMatch(/enviarCobro\(\{[^}]*cuotas: elegida\.cuotas/);
  });

  it("el botón usa el mismo texto que Mercado Pago ('Pagar en N cuotas de $X', corto en el celular)", () => {
    expect(sinComentarios).toContain("textoBotonPagar(");
    expect(sinComentarios).toContain("textoBoton.corto");
    expect(sinComentarios).toContain("textoBoton.largo");
  });

  it("con débito deshabilitado en el admin, sólo crédito", () => {
    expect(modalidadesPaywayHabilitadas(["credito"])).toEqual(["credito"]);
    expect(modalidadesPaywayHabilitadas(undefined)).toEqual(["credito", "debito"]);
  });
});

describe("CheckoutClient: sin elección de cuotas antes del pedido", () => {
  it("retira el selector previo: las cuotas se eligen en el formulario de los dos procesadores", () => {
    expect(checkout).not.toMatch(/\bOpcionesCuotas\b/);
    expect(checkout).not.toContain("cuotasEnFormulario");
    expect(checkout).not.toContain("cuotasSel");
  });

  it("Payway informa su elección al resumen lateral y el pedido actualizado, como Mercado Pago", () => {
    expect(checkout).toMatch(/<PagoPayway[\s\S]*?onEleccionCuotas=\{setEleccionCuotas\}[\s\S]*?\/>/);
    expect(checkout).toMatch(/<PagoPayway[\s\S]*?onPedidoActualizado=\{alActualizarPedido\}[\s\S]*?\/>/);
    expect(checkout).toMatch(/<ResumenTotalPedido confirmado=\{confirmado\} eleccion=\{eleccionCuotas\} \/>/);
  });
});

describe("PagoPayway: tarjetas del convenio (Visa, Mastercard, American Express y Cabal)", () => {
  const sinComentarios = componente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("muestra los logos bajo crédito y débito, y si no hay ninguno el texto del convenio", () => {
    expect(sinComentarios).toMatch(/logosCredito\.length > 0[\s\S]*<PaymentLogos[\s\S]*textoMarcasPayway\("credito"\)/);
    expect(sinComentarios).toMatch(/logosDebito\.length > 0[\s\S]*<PaymentLogos[\s\S]*textoMarcasPayway\("debito"\)/);
  });

  it("no nombra Naranja ni Diners en los textos de las opciones", () => {
    expect(sinComentarios).not.toMatch(/"[^"]*(Naranja|Diners)[^"]*"/);
  });

  it("el selector de marca ofrece sólo las del convenio y se valida contra ellas", () => {
    expect(sinComentarios).toContain("MARCAS_CONVENIO.map(");
    expect(sinComentarios).not.toMatch(/options=\{MARCAS\.map/);
    expect(sinComentarios).toContain("validarMarcaDelConvenio(marca, modalidad)");
  });

  it("el checkout le pasa los logos y los muestra bajo la tarjeta del medio Payway", () => {
    expect(checkout).toMatch(/<PagoPayway[\s\S]*tarjetas=\{tarjetasDelConvenioPayway\}/);
    expect(checkout).toMatch(/m\.slug === SLUG_PAYWAY\s*\?\s*logosTarjetas\(tarjetasDelConvenioPayway\)/);
  });
});

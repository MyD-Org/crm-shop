import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guardas de texto del checkout (sin montar React: acá no hay jsdom). Los medios de pago salen de
 * la tabla del CRM, sin flags: el paso Pago ofrece los medios activos que aplican, cae a
 * "a_coordinar" si no hay ninguno, el pedido viaja con el slug elegido y Mercado Pago salta al cobro
 * en línea. Ningún componente del cliente importa los flags (se evalúan en el server).
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const fuente = readFileSync(join(__dirname, "CheckoutClient.tsx"), "utf8");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

describe("CheckoutClient con medios de pago de la tabla", () => {
  it("el paso Pago ofrece los medios aplicables a la modalidad y trae la nota para los manuales", () => {
    expect(fuente).toContain("const mediosParaElegir = mediosParaModalidad(mediosPago, entrega, opcionesMedios);");
    expect(fuente).toContain(">Medio de pago</h2>");
    expect(fuente).toContain("{!pagaEnLinea && <p");
    expect(fuente).toContain("{NOTA_PAGO_A_CONFIRMAR}");
  });

  it("sin medios aplicables muestra la sección Pago con el aviso de coordinar", () => {
    expect(fuente).toContain(">Pago</h2>");
    expect(fuente).toContain("{AVISO_PAGO_A_COORDINAR}");
    expect(fuente).toContain(
      '"El pago se coordina con un asesor después de confirmar su pedido."',
    );
    expect(fuente).toContain('medioSel?.slug ?? "a_coordinar"');
  });

  it("el pedido viaja con el slug del medio elegido", () => {
    expect(fuente).toContain("pagoMetodo: pagoParaEnviar,");
  });

  it("Mercado Pago salta al cobro en línea (también al rescatar un pendiente)", () => {
    expect(fuente).toContain("confirmado && confirmado.pagoEnLinea && !pagado");
    expect(fuente).toContain("<PagoMercadoPago");
    expect(fuente).toContain("pagoEnLinea: esPagoEnLinea(pagoParaEnviar),");
    expect(fuente).toContain("pagoEnLinea: true,");
  });

  it("el rescate del pendiente corre siempre: el servidor decide si hay algo que retomar", () => {
    expect(fuente).toContain('"/api/pedidos/pendiente"');
    expect(fuente).toContain("fetch(url)");
    expect(fuente).toContain("useState(true)");
  });

  it("el pie bajo Confirmar sale del medio elegido", () => {
    expect(fuente).toContain("pieDelMedio(medioSel)");
  });

  it("la confirmación muestra el contacto de la sucursal siempre que el servidor lo mande", () => {
    expect(fuente).toContain("!pagado && confirmado.contacto");
    expect(fuente).toContain("contacto: json.contacto ?? null,");
  });
});

describe("los flags no salen del server", () => {
  it('ningún "use client" importa @/flags ni un *-flag', () => {
    const culpables = archivos(SRC)
      .filter((p) => /\.(ts|tsx)$/.test(p))
      .filter((p) => {
        const t = readFileSync(p, "utf8");
        // El import, no la mención: los comentarios sí apuntan al archivo.
        return /^\s*["']use client["']/.test(t) && /from\s+["'](?:[^"']*-flag|@\/flags)["']/.test(t);
      });
    expect(culpables).toEqual([]);
  });
});

describe("CheckoutClient con cuenta corriente", () => {
  it("recibe el flag del server y lo usa para elegir los medios (sin decidirlo en el navegador)", () => {
    expect(fuente).toContain("esCuentaCorriente = false,");
    expect(fuente).toContain("const opcionesMedios = { esCuentaCorriente };");
    expect(fuente).toContain("medioElegido(mediosPago, entrega, medioSlug, opcionesMedios)");
  });

  it("muestra el único medio como texto informativo y no ofrece cuotas ni lista por medio", () => {
    expect(fuente).toContain("{textoPagaConMedio(medioSel.nombre)}");
    expect(fuente).toContain("pagoParaCotizar(mediosPago, entrega, esCuentaCorriente ? null : medioSel)");
  });

  it("el pedido a confirmar informa con qué medio paga, en usted", () => {
    expect(fuente).toContain("todavía no se realizó ningún cobro. {textoPagaConMedio(medioSel.nombre)}");
  });
});

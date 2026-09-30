import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas de texto del checkout con el flag `pedido-a-confirmar`: el paso Pago con medios del CRM
 * sólo se arma en `modoMedios`, no deja el cobro en línea a la vista, y el flag no llega al bundle
 * del cliente (viaja como booleano desde el server).
 */
const fuente = readFileSync(join(__dirname, "CheckoutClient.tsx"), "utf8");

describe("CheckoutClient con el flag pedido-a-confirmar", () => {
  it("el paso Pago con medios del CRM sólo se ve en modoMedios y trae la nota", () => {
    const titulo = fuente.indexOf(">Medio de pago</h2>");
    expect(titulo).toBeGreaterThan(-1);
    expect(fuente.slice(0, titulo).lastIndexOf("{modoMedios && (")).toBeGreaterThan(-1);
    expect(fuente).toContain("{NOTA_PAGO_A_CONFIRMAR}");
  });

  it("las opciones fijas quedan detrás de !modoMedios", () => {
    expect(fuente).toContain("{!modoMedios && (<>");
  });

  it("el pedido viaja con el slug del medio elegido", () => {
    expect(fuente).toContain("pagoMetodo: pagoParaEnviar,");
    expect(fuente).toContain('modoMedios ? (medioSel?.slug ?? "a_coordinar") : pagoElegido');
  });

  it("el cliente no importa el flag", () => {
    expect(fuente).not.toMatch(/from\s+["'][^"']*pedido-a-confirmar-flag["']/);
  });

  it("la confirmación muestra el bloque de contacto sólo con el flag y con el contacto del server", () => {
    expect(fuente).toContain("pedidoAConfirmar && !pagado && confirmado.contacto");
  });
});

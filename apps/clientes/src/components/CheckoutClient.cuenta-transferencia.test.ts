import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas de texto del checkout con los datos de la cuenta para transferir (change
 * `pago-transferencia-comprobante`): ya no promete "Le enviamos el CBU", pide la cuenta junto con
 * la cotización cuando el medio es Transferencia, la muestra en el paso Pago y en Pedido recibido con lo que devolvió el pedido.
 */
const fuente = readFileSync(join(__dirname, "CheckoutClient.tsx"), "utf8");

describe("CheckoutClient: cuenta para transferir", () => {
  it("elimina el copy viejo del CBU", () => {
    expect(fuente).not.toContain("Le enviamos el CBU");
  });

  it("pide la cuenta con la cotización sólo si el medio es transferencia, y recotiza al cambiar el local", () => {
    expect(fuente).toContain("const conCuenta = pagoParaEnviar === SLUG_TRANSFERENCIA;");
    expect(fuente).toContain("conCuenta,");
    expect(fuente).toContain("sucursalRetiro: localParaCuenta,");
  });

  it("muestra la cuenta en el paso Pago", () => {
    expect(fuente.match(/<BloqueCuentaPago /g)?.length).toBe(1);
  });

  it("el pie del resumen con transferencia es coherente con los datos mostrados; otros medios mantienen su texto", () => {
    expect(fuente).toContain("? pieTransferencia(Boolean(cotizacion?.cuentaTransferencia))");
    expect(fuente).toContain("pieDelMedio(medioSel)");
  });

  it("Pedido recibido usa la cuenta congelada que devolvió el pedido", () => {
    expect(fuente).toContain("cuentaPago: json.cuentaPago ?? null,");
    expect(fuente).toContain("<CuentaTransferencia cuenta={confirmado.cuentaPago ?? null} importe={confirmado.total} />");
  });
});

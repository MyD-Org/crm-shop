import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guarda del código fuente del checkout (patrón de CheckoutClient.cambiar-medio.test.ts): el cupón
 * viaja al cotizar y al confirmar, el 409 del cupón tiene su rama, las cards saben si el cupón aplica
 * y el cambio de medio cotiza con el cupón del pedido.
 */
const fuente = readFileSync(join(__dirname, "CheckoutClient.tsx"), "utf8");

describe("CheckoutClient con cupón", () => {
  it("manda el cupón, maneja el 409 del cupón y avisa en las cards", () => {
    expect(fuente).toContain('motivo === "cupon"');
    expect(fuente).toContain("cuponNoAplica=");
    expect(fuente).toContain("pedidoId:");
    expect(fuente).toContain("<CampoCupon");
    expect(fuente).toContain("<LineaCupon");
    // Tracking: el nombre de la promoción, nunca el código.
    expect(fuente).toContain("cupon: String(json.cotizacion.cupon.nombre)");
  });
});

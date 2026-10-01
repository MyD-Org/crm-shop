import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ausencia de las reglas fijas de envío (change `envio-gratis-configurable`): la regla vive en el
 * CRM (`reglas_venta.envio_*`) y llega por `ConfigEnvio`. Si vuelve una lista de ciudades, un
 * mínimo en código o el flag `envio`, este test lo dice.
 */

const RAIZ = join(__dirname, "..");
const PROHIBIDOS = /CIUDADES_ENVIO|MINIMO_ENVIO|ciudadConEnvio|envioHabilitado|envio-flag|envioFlag|envio_no_disponible\b/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

describe("reglas fijas de envío", () => {
  it("no quedan CIUDADES_ENVIO, MINIMO_ENVIO, ciudadConEnvio ni el flag `envio` en src", () => {
    const yo = join(RAIZ, "lib", "envio-sin-reglas-fijas.test.ts");
    const hallazgos = archivos(RAIZ)
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== yo)
      .filter((f) => PROHIBIDOS.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(hallazgos).toEqual([]);
  });

  it("las reglas de sucursales (aceptaEnvio / envioCiudades) siguen intactas", () => {
    const sucursales = readFileSync(join(RAIZ, "lib", "sucursales.ts"), "utf8");
    expect(sucursales).toContain("aceptaEnvio");
    expect(sucursales).toContain("envioCiudades");
  });
});

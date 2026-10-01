import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda de los flags `pagos` y `pedido-a-confirmar` (change `medios-pago-desde-admin`): los medios
 * de pago salen de la tabla del CRM y nada del código decide por esos interruptores. Los símbolos
 * se arman por partes para que este archivo no se detecte a sí mismo.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const RETIRADOS = [
  ["pagos", "Flag"],
  ["pedidoAConfirmar", "Flag"],
  ["pagos", "Habilitados"],
  ["pedidoAConfirmar", "Habilitado"],
  ["pagos", "Disponibles"],
  ["pagos", "-flag"],
  ["pedido-a-confirmar", ""],
].map(([a, b]) => a + b);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

describe("flags retirados", () => {
  it("ningún archivo de src los menciona", () => {
    const hallazgos = archivos(SRC)
      .filter((p) => /\.(ts|tsx)$/.test(p))
      .filter((p) => !p.endsWith("flags-retirados.test.ts"))
      .flatMap((p) => {
        const t = readFileSync(p, "utf8");
        return RETIRADOS.filter((s) => t.includes(s)).map((s) => `${p.replace(SRC, "")}: ${s}`);
      });
    expect(hallazgos).toEqual([]);
  });
});

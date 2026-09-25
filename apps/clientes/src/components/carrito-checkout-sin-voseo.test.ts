import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda estática de registro formal de usted (CLAUDE.md raíz) para el
 * carrito, el checkout y el pago: los textos que ve quien compra. Misma
 * técnica que `home/sin-voseo.test.ts`, con los verbos de voseo que ya
 * aparecieron en estas pantallas.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

const ARCHIVOS = [
  "components/CarritoClient.tsx",
  "components/CartPreview.tsx",
  "components/CheckoutClient.tsx",
  "components/PagoMercadoPago.tsx",
  "components/CuotasResumen.tsx",
  "hooks/useCotizacion.ts",
  "lib/pagos/tipos.ts",
  "lib/cuotas-textos.ts",
  "lib/envio.ts",
];

const REGISTRO =
  /\b(?:tu|tus|te|vos|sos|probá|revisá|ingresá|elegí|escribinos|podés|tenés|querés|pagás|pagá|retirás|recargá|completá|llamá|llamalos|usá|esperá|intentá|volvé|pedí|dale|ojo|che)\b/i;

function limpiar(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function infracciones(texto: string): string[] {
  const limpio = limpiar(texto);
  const lineas = limpio.split("\n");
  const numeros = new Set<number>();
  for (const m of limpio.matchAll(new RegExp(REGISTRO.source, "gi"))) {
    numeros.add(limpio.slice(0, m.index).split("\n").length);
  }
  return [...numeros].sort((a, b) => a - b).map((n) => `${n}: ${lineas[n - 1].trim()}`);
}

describe("carrito, checkout y pago: registro formal de usted", () => {
  it.each(ARCHIVOS)("%s no tutea ni vosea", (archivo) => {
    expect(infracciones(readFileSync(join(SRC, archivo), "utf8"))).toEqual([]);
  });

  it("la guarda detecta voseo", () => {
    expect(infracciones('const t = "Retirás en el local o lo coordinamos con vos";')).not.toEqual([]);
    expect(infracciones("<p>Revise sus datos</p>")).toEqual([]);
  });
});

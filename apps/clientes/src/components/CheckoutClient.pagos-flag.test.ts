import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Test a nivel de código fuente, sin montar React (mismo criterio que
 * PagoMercadoPago.test.ts: acá no hay jsdom).
 *
 * Fija los tres puntos del checkout que el flag de pagos tiene que cortar, y
 * que el flag en sí nunca llegue al navegador: el flag `pagos` de Vercel Flags
 * se evalúa en el server, y un client component que lo importara no podría
 * leerlo (y mostraría los pagos distinto de lo que valida el server).
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const fuente = readFileSync(join(SRC, "components/CheckoutClient.tsx"), "utf8");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

describe("CheckoutClient con el flag de pagos", () => {
  it("los métodos salen del flag que llega por prop", () => {
    expect(fuente).toContain("pagosDisponibles(entrega, pagosHabilitados)");
  });

  it("el rescate del pendiente de Mercado Pago no corre con los pagos apagados", () => {
    const inicio = fuente.indexOf("useEffect(() => {");
    const efecto = fuente.slice(inicio, fuente.indexOf("}, [pagosHabilitados]);", inicio));
    expect(efecto).toContain('fetch("/api/pedidos/pendiente")');
    // El corte va ANTES del fetch.
    expect(efecto.indexOf("if (!pagosHabilitados) return;")).toBeGreaterThan(-1);
    expect(efecto.indexOf("if (!pagosHabilitados) return;")).toBeLessThan(
      efecto.indexOf('fetch("/api/pedidos/pendiente")'),
    );
  });

  it('"Forma de pago" sólo se renderiza con los pagos prendidos', () => {
    const titulo = fuente.indexOf(">Forma de pago</h2>");
    expect(titulo).toBeGreaterThan(-1);
    const antes = fuente.slice(0, titulo);
    const compuerta = antes.lastIndexOf("{pagosHabilitados && (");
    expect(compuerta).toBeGreaterThan(-1);
    // Entre la compuerta y el título sólo está la apertura de la sección.
    expect(antes.slice(compuerta).match(/<section/g)).toHaveLength(1);
  });

  it("con los pagos apagados muestra el aviso, con el texto exacto", () => {
    expect(fuente).toContain(
      '"El pago se coordina con un asesor después de confirmar su pedido."',
    );
    expect(fuente).toContain("{!pagosHabilitados && (");
  });

  it("no se borró la rama de Mercado Pago", () => {
    expect(fuente).toContain('confirmado && pagoElegido === "mercadopago" && !pagado');
    expect(fuente).toContain("<PagoMercadoPago");
  });
});

describe("el flag de pagos no sale del server", () => {
  it('ningún "use client" importa pagos-flag ni @/flags', () => {
    const culpables = archivos(SRC)
      .filter((p) => /\.(ts|tsx)$/.test(p))
      .filter((p) => {
        const t = readFileSync(p, "utf8");
        // El import, no la mención: los comentarios sí apuntan al archivo.
        return /^\s*["']use client["']/.test(t) && /from\s+["'](?:[^"']*pagos-flag|@\/flags)["']/.test(t);
      });
    expect(culpables).toEqual([]);
  });
});

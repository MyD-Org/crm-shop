import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas de texto (sin montar React: acá no hay jsdom) de "Cambiar medio de pago" en la pantalla
 * de cobro en línea. La lógica de cuándo se ofrece está en `lib/cambiar-medio-pago.ts` (con tests).
 */
const fuente = readFileSync(join(__dirname, "CheckoutClient.tsx"), "utf8");

describe("CheckoutClient: cambiar medio de pago", () => {
  it("el botón sólo se renderiza detrás de puedeCambiarMedioPago (ni pagado ni cobro en vuelo) y sin cuenta corriente", () => {
    expect(fuente).toContain("puedeCambiarMedioPago({ pagado, pagoEnConfirmacion }) && !esCuentaCorriente");
    expect(fuente.split(': "Cambiar medio de pago"}')).toHaveLength(2);
  });

  it("no cancela: confirma sobre el mismo pedido con POST /api/pedidos/:id/medio y vuelve al paso que dice pasoAlCambiarMedio", () => {
    expect(fuente).not.toContain("/cancelar?para=cambiar-medio");
    expect(fuente).toContain("`/api/pedidos/${previo.id}/medio`");
    expect(fuente).toContain("if (pedidoACambiar) {");
    expect(fuente).toContain("irAPaso(pasoAlCambiarMedio({ estadoCargado }))");
  });

  it("no crea otro pedido al cambiar: la rama del cambio sale antes de POST /api/pedidos", () => {
    const cuerpo = fuente.slice(fuente.indexOf("async function confirmar()"));
    expect(cuerpo.indexOf("confirmarCambioDeMedio(pedidoACambiar)")).toBeGreaterThan(0);
    expect(cuerpo.indexOf("confirmarCambioDeMedio(pedidoACambiar)")).toBeLessThan(cuerpo.indexOf('fetch("/api/pedidos"'));
  });

  it('"Volver al carrito" queda como acción secundaria chica', () => {
    expect(fuente).toContain('"Cancelando…" : "Volver al carrito"');
  });
});

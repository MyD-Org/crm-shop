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
    // Dos lugares: el cobro en línea y la pantalla de transferencia (ésta, sólo sin comprobante informado).
    expect(fuente.split(': "Cambiar medio de pago"}')).toHaveLength(3);
    expect(fuente).toContain("{!comprobanteInformado && (\n              <Button variant=\"ghost\" onClick={cambiarMedio}");
  });

  it("no cancela: confirma sobre el mismo pedido con POST /api/pedidos/:id/medio y vuelve siempre al paso Pago", () => {
    expect(fuente).not.toContain("/cancelar?para=cambiar-medio");
    expect(fuente).toContain("`/api/pedidos/${previo.id}/medio`");
    expect(fuente).toContain("if (pedidoACambiar) {");
    expect(fuente).toContain('irAPaso("pago");');
    // Un pedido retomado se precarga con su entrega y su contacto.
    expect(fuente).toContain("if (!estadoCargado && json?.entrega) precargarDelPedido(json.entrega, json.contacto);");
    expect(fuente).toContain("(pedidoACambiar !== null || (datosCompletos && facturacionCompleta && (!aDomicilio || envioDisponible)))");
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

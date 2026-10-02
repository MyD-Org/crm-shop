import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Guardas de fuente (sin jsdom): el checkout parte de la elección y sincroniza la cookie sin bloquear. */
const fuente = readFileSync(join(__dirname, "CheckoutClient.tsx"), "utf8");
const pagina = readFileSync(join(__dirname, "..", "app", "checkout", "page.tsx"), "utf8");

describe("CheckoutClient: valores iniciales y sync de la ubicación", () => {
  it("la página pasa la elección del visitante", () => {
    expect(pagina).toContain("ubicacionDelVisitante");
    expect(pagina).toContain("eleccionInicial={");
  });

  it("los estados iniciales salen de estadoInicialCheckout", () => {
    expect(fuente).toContain("estadoInicialCheckout({");
  });

  it("sincroniza con fire-and-forget y sin router.refresh", () => {
    expect(fuente).toContain("cuerpoDeSincronizacion({");
    expect(fuente).toContain("sincronizarUbicacion(fetch,");
    // El efecto de sync no refresca la página (los refresh que hay son de otros flujos).
    const efecto = fuente.slice(fuente.indexOf("const claveSync"), fuente.indexOf("// Pasos del checkout"));
    expect(efecto).toContain("sincronizarUbicacion");
    expect(efecto).not.toContain("router");
  });

  it("el pedido y la cotización siguen sin provincia en retiro", () => {
    expect(fuente).toContain("provincia: aDomicilio && provinciaEntrega ? provinciaEntrega : undefined,");
    expect(fuente).toContain("entregaProvincia: aDomicilio && provinciaEntrega ? provinciaEntrega : undefined,");
  });
});

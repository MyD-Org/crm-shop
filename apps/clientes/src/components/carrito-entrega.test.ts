import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guardas de fuente del carrito con la elección "Enviar a" (sin DOM en los tests): con retiro el
 * carrito cotiza como retiro, SIN provincia (la provincia pisaría la sucursal elegida) y sin la
 * barra de envío gratis (la page le pasa `provincia = null`).
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const leer = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

describe("carrito según la elección", () => {
  const cliente = leer("components", "CarritoClient.tsx");

  it("cotiza con el entregaTipo recibido (default retiro) y sólo manda provincia en envío", () => {
    expect(cliente).toMatch(/entregaTipo = "retiro"/);
    expect(cliente).toMatch(
      /useCotizacion\(\{\s*entregaTipo,\s*conProgresoCuotas: true,\s*\.\.\.\(entregaTipo === "envio" && provincia \? \{ provincia \} : \{\}\),\s*\.\.\.\(entregaTipo === "retiro" && sucursalRetiro \? \{ sucursalRetiro \} : \{\}\),\s*\}\)/,
    );
    expect(cliente).not.toMatch(/useCotizacion\(\{\s*entregaTipo: "retiro"/);
  });

  it("la barra de envío gratis usa la provincia recibida (null con retiro)", () => {
    expect(cliente).toContain("progresoEnvioGratis(subtotal, provincia, configEnvio)");
  });

  it("la page deriva entregaTipo/provincia de la elección con entregaDelCarrito", () => {
    const page = leer("app", "carrito", "page.tsx");
    expect(page).toContain("entregaDelCarrito(eleccion)");
    expect(page).toContain("entregaTipo={entregaTipo}");
    expect(page).not.toContain("?.ubicacion?.provincia");
  });

  it("con retiro cotiza con el mismo local que el checkout (venta sin stock: las mismas líneas a pedido)", () => {
    const page = leer("app", "carrito", "page.tsx");
    expect(page).toContain(
      'entregaTipo === "retiro" ? ((await opcionesCheckoutDelVisitante().catch(() => null))?.localInicial ?? null) : null;',
    );
    expect(page).toContain("sucursalRetiro={sucursalRetiro}");
    // El checkout arranca con ese mismo `localInicial` (salvo una elección válida, que ya es la zona).
    expect(leer("lib", "checkout-ubicacion.ts")).toContain('localRetiro: sucursalElegida ?? e.localInicial ?? "",');
  });
});

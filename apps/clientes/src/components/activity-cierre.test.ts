import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Con Cache Components, Next esconde la página con `<Activity>` en vez de
 * desmontarla: lo transitorio (hojas, diálogos, confirmaciones) tiene que
 * cerrarse al salir o reaparece abierto al volver (NR-4). Guarda estática:
 * cada componente de página con un diálogo propio llama `useAlOcultar`.
 */
const CON_CIERRE = [
  "catalogo/CatalogoFiltrosSheet.tsx",
  "home/SeccionEditable.tsx",
  "home/BarraEdicion.tsx",
  "legales/BotonDatosLegales.tsx",
  "mi-cuenta/DatosCuenta.tsx",
  "mi-cuenta/DireccionesEnvio.tsx",
  "mi-cuenta/cuenta-corriente/InformarPago.tsx",
  "CheckoutClient.tsx",
];

describe("cierre de lo transitorio al navegar (Activity)", () => {
  it.each(CON_CIERRE)("%s llama useAlOcultar", (archivo) => {
    const src = readFileSync(join(__dirname, archivo), "utf8");
    expect(src).toMatch(/useAlOcultar\(\(\) =>/);
  });

  it("el header y el provider de favoritos no leen la ruta con hooks que suspenden el shell", () => {
    const favoritos = readFileSync(join(__dirname, "..", "context", "FavoritosContext.tsx"), "utf8");
    const carrito = readFileSync(join(__dirname, "CartPreview.tsx"), "utf8");
    expect(favoritos).not.toMatch(/usePathname\(/);
    expect(carrito).not.toMatch(/usePathname\(/);
  });
});

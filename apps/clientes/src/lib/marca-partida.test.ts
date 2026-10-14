import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/marca-partida.json";
import { MARCA_POR_DEFECTO, resolverMarca } from "./marca-base";

// Espejo del admin (apps/admin/src/lib/__fixtures__/marca-partida.json): el admin muestra estos
// textos como "en uso". Si cambia uno de los dos lados, este test falla.
describe("fixture marca-partida (contrato con el admin)", () => {
  it("los textos de la base central son los de MARCA_POR_DEFECTO", () => {
    const { nombre, titulo, descripcion, ogTextos } = fixture.central;
    expect({ nombre, titulo, descripcion, ogTextos }).toEqual({
      nombre: MARCA_POR_DEFECTO.nombre,
      titulo: MARCA_POR_DEFECTO.titulo,
      descripcion: MARCA_POR_DEFECTO.descripcion,
      ogTextos: MARCA_POR_DEFECTO.ogTextos,
    });
  });

  it("central con otro nombre: el título sigue la plantilla del fixture", () => {
    const m = resolverMarca({ base: "central", nombre: "Otra Tienda" });
    expect(fixture.central.tituloConNombre.replace("{nombre}", "Otra Tienda")).toBe(m.titulo);
  });

  it("base genérica con nombre: título, descripción y textos de la imagen siguen el fixture", () => {
    const m = resolverMarca({ base: "generica", nombre: "Tienda Uno" });
    expect(fixture.generica.tituloConNombre.replace("{nombre}", "Tienda Uno")).toBe(m.titulo);
    expect(fixture.generica.descripcionConNombre.replace("{nombre}", "Tienda Uno")).toBe(m.descripcion);
    expect(fixture.generica.ogTextos).toEqual(m.ogTextos);
  });
});

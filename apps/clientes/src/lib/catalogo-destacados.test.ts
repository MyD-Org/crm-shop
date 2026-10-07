import { describe, expect, it } from "vitest";
import {
  esCategoriaAccesorio,
  esNombreAccesorio,
  idsCategoriasAccesorio,
  literalUuids,
  preordenArbol,
  type CategoriaArbol,
} from "./catalogo-destacados";

describe("esNombreAccesorio (sólo la primera palabra)", () => {
  it.each([
    "Acoplador de rieles negro",
    "Soporte para panel 60x60",
    "Uniones para cablecanal",
    "Tapón ciego",
    "Terminales de cobre 6 mm",
    "Conectores rápidos x 10",
    "Kit de fijación para panel",
    "Kits de montaje",
    "Kit de instalación para spot",
    "Control remoto para tira",
    "Controles remotos RGB",
    "  ADAPTADOR E27 a GU10",
    "Grampa omega",
    "Clip de fijación",
    "Tapa ciega",
    "Repuesto de vidrio",
    "Accesorio para riel",
    "Empalme recto",
    "Amplificador RGB",
    "Acople rápido",
  ])("%s es accesorio", (nombre) => {
    expect(esNombreAccesorio(nombre)).toBe(true);
  });

  it.each([
    "Panel LED 60x60 con soporte",
    "Tapaluz bastidor",
    "Kit solar 1 kW",
    "Lámpara LED 9 W con adaptador",
    "Unionista",
    "Terminator",
    "Controlador RGB",
    "Reflector LED 50 W",
    "Fuente switching 12 V",
    "Tira LED con control remoto",
  ])("%s es principal", (nombre) => {
    expect(esNombreAccesorio(nombre)).toBe(false);
  });
});

describe("esCategoriaAccesorio", () => {
  it.each(["Accesorios", "Accesorios eléctricos", "Repuestos y accesorios", " ACCESORIO", "Repuesto"])(
    "%s es de accesorios",
    (n) => expect(esCategoriaAccesorio(n)).toBe(true),
  );
  // Sólo si arranca así: una categoría que también nombra accesorios vende sobre todo principales.
  it.each(["Iluminación", "Lámparas", "Accesoriosx", "Llaves, tomas y accesorios", "Iluminación y repuestos"])("%s no", (n) =>
    expect(esCategoriaAccesorio(n)).toBe(false),
  );
});

const nodo = (id: string, nombre: string, parentId: string | null = null, orden = 0): CategoriaArbol => ({
  id,
  parentId,
  nombre,
  orden,
});

describe("idsCategoriasAccesorio", () => {
  it("una categoría de accesorios arrastra a toda su descendencia", () => {
    const arbol = [
      nodo("r", "Iluminación"),
      nodo("a", "Lámparas", "r"),
      nodo("c", "Accesorios", "r"),
      nodo("c1", "Soportes", "c"),
      nodo("c2", "Tapas", "c1"),
      nodo("x", "Repuestos"),
    ];
    expect(idsCategoriasAccesorio(arbol).sort()).toEqual(["c", "c1", "c2", "x"]);
  });

  it("sin árbol, nada", () => {
    expect(idsCategoriasAccesorio([])).toEqual([]);
  });
});

describe("preordenArbol", () => {
  it("raíces primero, cada rama entera, hermanas por orden y nombre", () => {
    const arbol = [
      nodo("b", "Cables", null, 2),
      nodo("a", "Iluminación", null, 1),
      nodo("a2", "Reflectores", "a", 0),
      nodo("a1", "Lámparas", "a", 0),
      nodo("a3", "Accesorios", "a", 5),
      nodo("a11", "Filamento", "a1", 0),
      nodo("huerfana", "Sin madre", "inactiva", 0),
    ];
    expect(preordenArbol(arbol)).toEqual(["a", "a1", "a11", "a2", "a3", "b"]);
  });
});

describe("literalUuids", () => {
  it("arma el literal de arreglo y descarta lo que no es uuid", () => {
    const id = "6f1c2b3a-1111-4222-8333-944455556666";
    expect(literalUuids([id, "'); drop table x; --"])).toBe(`{${id}}`);
    expect(literalUuids([])).toBe("{}");
  });
});

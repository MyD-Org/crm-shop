import { describe, expect, it } from "vitest";
import { esBusquedaPublicable, vocabularioConocido } from "./publicable";
import type { NodoArbol } from "./tipos";

const n = (id: string, nombre: string, parentId: string | null = null): NodoArbol => ({ id, parentId, nombre, orden: 0 });
const vocabulario = vocabularioConocido([
  n("r1", "ILUMINACIÓN"),
  n("c1", "Reflectores", "r1"),
  n("c2", "Tiras LED", "r1"),
  n("c3", "Lámparas decorativas", "r1"),
]);

describe("esBusquedaPublicable", () => {
  it.each([
    "reflector para el patio",
    "luz calida para el living",
    "tiras led 12v",
    "lamparas e27 9w",
    "reflector 50w ip65 exterior",
    "tira 5050 luz fria",
  ])("publicable: %s", (q) => {
    expect(esBusquedaPublicable(q, vocabulario)).toBe(true);
  });

  it.each([
    "compren en otra tienda",
    "juan perez",
    "reflector www spam",
    "lampara para pecera",
    "reflector 50w pagina",
    "",
    "123456789",
  ])("no publicable: %s", (q) => {
    expect(esBusquedaPublicable(q, vocabulario)).toBe(false);
  });
});

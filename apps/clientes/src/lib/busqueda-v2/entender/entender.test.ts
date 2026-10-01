import { describe, expect, it, vi } from "vitest";
import type { NodoArbol } from "../../busqueda-inteligente/tipos";
import type { Respuestas } from "../../busqueda-inteligente/jev";
import { entender, type ClienteJev } from "./entender";

const arbol: NodoArbol[] = [
  { id: "i", parentId: null, nombre: "ILUMINACION", orden: 1 },
  { id: "r", parentId: "i", nombre: "Reflectores", orden: 1 },
  { id: "l", parentId: "i", nombre: "Lámparas", orden: 2 },
  { id: "e", parentId: null, nombre: "ELECTRICIDAD", orden: 2 },
  { id: "c", parentId: "e", nombre: "Contactores", orden: 1 },
];
const contar = async () => 10;

describe("entender", () => {
  it("un código no se interpreta ni llama a Jev", async () => {
    const jev = vi.fn<ClienteJev>();
    const r = await entender("DL-18W", { arbol, jev, contar });
    expect(r?.plan.intencion).toBe("codigo");
    expect(r?.plan.blandos.terminos).toEqual([]);
    expect(jev).not.toHaveBeenCalled();
  });

  it("un dato personal no se interpreta", async () => {
    expect(await entender("juan@correo.example", { arbol, jev: null, contar })).toBeNull();
    expect(await entender("   ", { arbol, jev: null, contar })).toBeNull();
  });

  it("una llamada principal y la subcategoría si la raíz salió ≥ 0,7; viaja la consulta normalizada", async () => {
    const jev = vi.fn<ClienteJev>(async (_c, preguntas): Promise<Respuestas> =>
      "sub" in preguntas
        ? { sub: { choice: "reflectores", confidence: 0.95 } }
        : {
            intencion: { choice: "producto", confidence: 0.99 },
            raiz: { choice: "iluminacion", confidence: 0.99 },
            tono: { choice: "no_especifica", confidence: 1 },
            ambiente: { choice: "exterior", confidence: 0.9 },
          },
    );
    const r = await entender("Proyector para el PATIO", { arbol, jev, contar });
    expect(jev).toHaveBeenCalledTimes(2);
    expect(jev.mock.calls[0][0]).toBe("proyector para el patio");
    expect(Object.keys(jev.mock.calls[0][1]).sort()).toEqual(["ambiente", "intencion", "raiz", "tono"]);
    expect(r?.plan.duros.categorias).toEqual(["Reflectores"]);
    expect(r?.plan.blandos.atributos).toEqual([{ id: "apto-exterior", peso: 0.9 }]);
    expect(r?.plan.blandos.terminos).toContainEqual({ texto: "reflector", peso: 0.7 });
    expect(r?.jevFallo).toBe(false);
    expect(r?.msJev).not.toBeNull();
  });

  it("sin presupuesto no pregunta la subcategoría", async () => {
    let t = 0;
    const jev = vi.fn<ClienteJev>(async () => {
      t += 2300;
      return { raiz: { choice: "iluminacion", confidence: 0.99 } };
    });
    await entender("reflector", { arbol, jev, contar, ahora: () => t });
    expect(jev).toHaveBeenCalledTimes(1);
  });

  it("Jev caído: plan determinista y `jevFallo` (no se guarda)", async () => {
    const r = await entender("reflector para el patio", { arbol, jev: async () => null, contar });
    expect(r?.jevFallo).toBe(true);
    expect(r?.plan.fuente).toBe("deterministico");
    expect(r?.plan.duros.categorias).toEqual([]);
    expect(r?.plan.blandos.categorias).toEqual([{ nombre: "Reflectores", peso: 0.8 }]);
  });
});

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

  it("un token que es una medida pura ('20a') ya no es código: se interpreta, pero entender() no emite ids de medida", async () => {
    for (const q of ["20a", "e27", "ip65", "9w"]) {
      const r = await entender(q, { arbol, jev: null, contar });
      expect(r?.plan.intencion, q).not.toBe("codigo");
      // Las medidas las mezcla aplicarMedidas (post-cache); entender() solo conserva el texto, con peso 0.4.
      expect(r?.plan.duros.atributos.some((id) => id.includes(":")), q).toBe(false);
      expect(r?.plan.blandos.atributos.some((a) => a.id.includes(":")), q).toBe(false);
    }
    // Sin id del diccionario que lo absorba ("e27" y "ip65" sí tienen), queda como texto de orden.
    for (const q of ["20a", "9w"]) {
      const r = await entender(q, { arbol, jev: null, contar });
      expect(r?.plan.blandos.terminos, q).toEqual([{ texto: q, peso: 0.4 }]);
    }
  });

  it("lo que parece una medida pero cae fuera de rango sigue siendo código ('12000k', 'ip70')", async () => {
    const jev = vi.fn<ClienteJev>();
    for (const q of ["12000k", "ip70"]) {
      expect((await entender(q, { arbol, jev, contar }))?.plan.intencion, q).toBe("codigo");
    }
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

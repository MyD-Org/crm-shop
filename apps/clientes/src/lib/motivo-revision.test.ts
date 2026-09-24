import { describe, expect, it } from "vitest";
import {
  PRIORIDAD_MOTIVOS,
  listaDistintaDeLaGeneral,
  motivoRevisionPedido,
  type EntradaMotivo,
} from "./motivo-revision";

const base: EntradaMotivo = {
  motivoContacto: null,
  complementoUsado: false,
  vinculado: false,
  listaContacto: null,
  idListaGeneral: "1",
};

describe("listaDistintaDeLaGeneral", () => {
  it("sin lista usable ⇒ es la general", () => {
    expect(listaDistintaDeLaGeneral(undefined, "1")).toBe(false);
    expect(listaDistintaDeLaGeneral(null, null)).toBe(false);
    expect(listaDistintaDeLaGeneral("", "1")).toBe(false);
  });
  it("misma lista que la general ⇒ no es distinta", () => {
    expect(listaDistintaDeLaGeneral("1", "1")).toBe(false);
  });
  it("otra lista ⇒ distinta", () => {
    expect(listaDistintaDeLaGeneral("7", "1")).toBe(true);
  });
  it("general desconocida y el contacto tiene lista ⇒ distinta (se avisa de más)", () => {
    expect(listaDistintaDeLaGeneral("1", null)).toBe(true);
  });
});

describe("motivoRevisionPedido", () => {
  it("nada aplica ⇒ null", () => {
    expect(motivoRevisionPedido(base)).toBeNull();
    expect(motivoRevisionPedido({ ...base, vinculado: true })).toBeNull();
  });

  it("vinculado, monotributo con DNI ⇒ documento_incompatible (el caso del 2026-09-24)", () => {
    expect(
      motivoRevisionPedido({ ...base, vinculado: true, motivoContacto: "documento_incompatible" }),
    ).toBe("documento_incompatible");
  });

  it("vinculado con condición desconocida ⇒ condicion_iva_desconocida", () => {
    expect(
      motivoRevisionPedido({ ...base, vinculado: true, motivoContacto: "condicion_iva_desconocida" }),
    ).toBe("condicion_iva_desconocida");
  });

  it("vinculado con complemento del checkout ⇒ facturacion_en_pedido", () => {
    expect(motivoRevisionPedido({ ...base, vinculado: true, complementoUsado: true })).toBe(
      "facturacion_en_pedido",
    );
  });

  it("no vinculado, documento de un contacto con la MISMA lista ⇒ sin revisión", () => {
    expect(motivoRevisionPedido({ ...base, listaContacto: { id: "1" } })).toBeNull();
    expect(motivoRevisionPedido({ ...base, listaContacto: { id: undefined } })).toBeNull();
  });

  it("no vinculado, documento de un contacto con OTRA lista ⇒ otra_lista_precios", () => {
    expect(motivoRevisionPedido({ ...base, listaContacto: { id: "7" } })).toBe("otra_lista_precios");
  });

  it("vinculado: la regla de la lista no aplica (compró a la suya)", () => {
    expect(motivoRevisionPedido({ ...base, vinculado: true, listaContacto: { id: "7" } })).toBeNull();
  });

  it("varios a la vez ⇒ el más importante, en el orden de PRIORIDAD_MOTIVOS", () => {
    expect(PRIORIDAD_MOTIVOS).toEqual([
      "documento_incompatible",
      "condicion_iva_desconocida",
      "facturacion_en_pedido",
      "otra_lista_precios",
    ]);
    expect(
      motivoRevisionPedido({
        ...base,
        motivoContacto: "condicion_iva_desconocida",
        complementoUsado: true,
        listaContacto: { id: "7" },
      }),
    ).toBe("condicion_iva_desconocida");
    expect(
      motivoRevisionPedido({ ...base, complementoUsado: true, listaContacto: { id: "7" } }),
    ).toBe("facturacion_en_pedido");
    expect(
      motivoRevisionPedido({
        ...base,
        vinculado: true,
        motivoContacto: "documento_incompatible",
        complementoUsado: true,
      }),
    ).toBe("documento_incompatible");
  });
});

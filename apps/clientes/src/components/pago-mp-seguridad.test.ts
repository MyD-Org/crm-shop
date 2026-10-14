import { describe, expect, it } from "vitest";
import { URL_SEGURIDAD_MP, cargarSeguridadMP, deviceIdMP } from "./pago-mp-seguridad";

/** Documento mínimo: sólo lo que usa el cargador (los tests unitarios corren en node, sin DOM). */
function documentoFalso() {
  const agregados: { src: string; async: boolean; atributos: Record<string, string> }[] = [];
  const doc = {
    querySelector: (selector: string) =>
      selector.includes("mercadopago.com/v2/security.js") ? (agregados.find((s) => s.src.includes("/v2/security.js")) ?? null) : null,
    createElement: () => {
      const atributos: Record<string, string> = {};
      return { src: "", async: false, atributos, setAttribute: (n: string, v: string) => void (atributos[n] = v) };
    },
    head: { appendChild: (nodo: never) => agregados.push(nodo) },
  };
  return { doc, agregados };
}

describe("script de seguridad de Mercado Pago", () => {
  it("agrega el script con view=checkout", () => {
    const { doc, agregados } = documentoFalso();
    expect(cargarSeguridadMP(doc)).toBe(true);
    expect(agregados).toHaveLength(1);
    expect(agregados[0].src).toBe(URL_SEGURIDAD_MP);
    expect(agregados[0].src).toBe("https://www.mercadopago.com/v2/security.js");
    expect(agregados[0].async).toBe(true);
    expect(agregados[0].atributos).toEqual({ view: "checkout" });
  });

  it("lo carga una sola vez: si ya está en la página no lo duplica", () => {
    const { doc, agregados } = documentoFalso();
    cargarSeguridadMP(doc);
    expect(cargarSeguridadMP(doc)).toBe(false);
    expect(agregados).toHaveLength(1);
  });

  it("en el servidor (sin document) no hace nada", () => {
    expect(typeof document).toBe("undefined");
    expect(cargarSeguridadMP()).toBe(false);
  });

  it("lee el id de dispositivo sólo si el script ya lo dejó como texto", () => {
    expect(deviceIdMP({ MP_DEVICE_SESSION_ID: "armor.abc123" })).toBe("armor.abc123");
    expect(deviceIdMP({ MP_DEVICE_SESSION_ID: undefined })).toBeUndefined();
    expect(deviceIdMP({ MP_DEVICE_SESSION_ID: 42 })).toBeUndefined();
    expect(deviceIdMP({})).toBeUndefined();
    expect(deviceIdMP()).toBeUndefined();
  });
});

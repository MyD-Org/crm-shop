import { describe, expect, it } from "vitest";
import { destinoEscaneo } from "./escaneo";

describe("destinoEscaneo", () => {
  it("el QR de la etiqueta va a la ficha, sea cual sea el dominio", () => {
    expect(destinoEscaneo("https://tienda.cliente.example/producto/1234")).toEqual({ tipo: "producto", id: "1234" });
    expect(destinoEscaneo("http://localhost:3000/producto/A%2FB/")).toEqual({ tipo: "producto", id: "A/B" });
  });

  it("otro link no se sigue", () => {
    expect(destinoEscaneo("https://otro.example/catalogo")).toEqual({ tipo: "invalido" });
    expect(destinoEscaneo("https://tienda.cliente.example/producto/1/extra")).toEqual({ tipo: "invalido" });
  });

  it("un código de barras se busca como código", () => {
    expect(destinoEscaneo("  VOLKAN-BLACK-40 ")).toEqual({ tipo: "codigo", codigo: "VOLKAN-BLACK-40" });
    expect(destinoEscaneo("7791234567890")).toEqual({ tipo: "codigo", codigo: "7791234567890" });
  });

  it("vacío o texto largo no es un código", () => {
    expect(destinoEscaneo("   ")).toEqual({ tipo: "invalido" });
    expect(destinoEscaneo("BEGIN:VCARD\nFN:Juan")).toEqual({ tipo: "invalido" });
    expect(destinoEscaneo("x".repeat(65))).toEqual({ tipo: "invalido" });
  });
});

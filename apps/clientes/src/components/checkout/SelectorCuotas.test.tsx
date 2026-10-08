import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OpcionCuotasPedido } from "@/lib/cuotas-pedido";
import { SelectorCuotas } from "./SelectorCuotas";

const unPago: OpcionCuotasPedido = { clave: "un_pago-1", cuotas: 1, tipo: "un_pago", montoCuota: 50000, total: 50000, pedidoCuotas: 1 };
const tres: OpcionCuotasPedido = { clave: "sin_interes-3", cuotas: 3, tipo: "sin_interes", montoCuota: 18000, total: 54000, pedidoCuotas: 3 };
const seis: OpcionCuotasPedido = {
  clave: "con_interes-6",
  cuotas: 6,
  tipo: "con_interes",
  montoCuota: 11000,
  total: 66000,
  pedidoCuotas: 1,
  cft: "169,00",
  tea: "130,00",
};

const html = (p: Partial<Parameters<typeof SelectorCuotas>[0]> = {}) =>
  renderToStaticMarkup(
    <SelectorCuotas
      opciones={[unPago, tres, seis]}
      elegida={unPago}
      onElegir={() => {}}
      marca={null}
      restringidas={[{ cuotas: 12, marcas: ["visa", "mastercard"] }]}
      procesador="Mercado Pago"
      {...p}
    />,
  ).replace(/\s/g, " ");

describe("SelectorCuotas", () => {
  // El Select del DS no pinta el valor elegido en un render estático: etiquetas y chip, en
  // `cuotas-formulario.test.ts` (filasSelectorCuotas).
  it("sin tarjeta: título 'Cuotas' y sin avisos", () => {
    const h = html();
    expect(h).toContain(">Cuotas<");
    expect(h).not.toContain("CFT");
    expect(h).not.toContain("sólo con");
  });

  it("con tarjeta: 'Cuotas con su Visa' y qué cuotas sin interés son de otras tarjetas", () => {
    const h = html({ marca: { id: "naranja", nombre: "Naranja" } });
    expect(h).toContain("Cuotas con su Naranja");
    expect(h).toContain("12 cuotas sin interés: sólo con Visa y Mastercard.");
  });

  it("sin interés elegida: sin aviso de financiación", () => {
    const h = html({ elegida: tres });
    expect(h).not.toContain("financia");
  });

  it("con interés elegida: CFT/TEA y el procesador del medio", () => {
    const h = html({ elegida: seis });
    expect(h).toContain("CFT 169,00% · TEA 130,00%. Las cuotas con interés las financia Mercado Pago.");
  });
});

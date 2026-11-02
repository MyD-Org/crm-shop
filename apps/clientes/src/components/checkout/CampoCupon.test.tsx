import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CuponAplicado } from "@/lib/cupones/tipos";
import { CampoCupon } from "./CampoCupon";

const aplicado: CuponAplicado = {
  codigo: "LUZ-7KQ2M", codigoId: "c1", promocionId: "p1", nombre: "Bot", pct: 10, pctAplicado: true, envioGratis: false,
  descuento: 2420, subtotalAntes: 20000, condiciones: "Sólo primera compra.", venceEn: null, verificado: true, aviso: null,
};

const html = (p: Partial<Parameters<typeof CampoCupon>[0]> = {}) =>
  renderToStaticMarkup(
    <CampoCupon cupon={null} aplicado={null} error={null} cargando={false} onAplicar={() => {}} onQuitar={() => {}} {...p} />,
  ).replace(/\s+/g, " ");

describe("CampoCupon", () => {
  it("sin cupón: la pregunta, el campo y Aplicar", () => {
    const h = html();
    expect(h).toContain("¿Tiene un código de descuento?");
    expect(h).toContain("<input");
    expect(h).toContain("Aplicar");
  });

  it("con cupón aplicado: el código, Quitar y Condiciones", () => {
    const h = html({ cupon: "luz-7kq2m", aplicado });
    expect(h).toContain("LUZ-7KQ2M");
    expect(h).toContain("Quitar");
    expect(h).toContain("Condiciones");
  });

  it("con error: el mensaje y Quitar (el cupón queda guardado)", () => {
    const h = html({ cupon: "LUZ-7KQ2M", error: { motivo: "vencido", mensaje: "Este cupón venció." } });
    expect(h).toContain("Este cupón venció.");
    expect(h).toContain("Quitar");
  });
});

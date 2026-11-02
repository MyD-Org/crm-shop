import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fmtPrecio } from "@/lib/format";
import type { CuponAplicado } from "@/lib/cupones/tipos";
import { LineaCupon } from "./LineaCupon";

const cupon = (o: Partial<CuponAplicado> = {}): CuponAplicado => ({
  codigo: "LUZ-7KQ2M", codigoId: "c1", promocionId: "p1", nombre: "Bot", pct: 10, pctAplicado: true, envioGratis: false,
  descuento: 2420, subtotalAntes: 20000, condiciones: "", venceEn: null, verificado: true, aviso: null, ...o,
});
const html = (c: CuponAplicado) => renderToStaticMarkup(<LineaCupon cupon={c} />).replace(/\s+/g, " ");

describe("LineaCupon", () => {
  it("el código, el % y el descuento en negativo", () => {
    const h = html(cupon());
    expect(h).toContain("Cupón LUZ-7KQ2M (10 %)");
    expect(h).toContain(`−${fmtPrecio(2420)}`.replace(/\s+/g, " "));
  });

  it("envío gratis y aviso", () => {
    const h = html(cupon({ pctAplicado: false, descuento: 0, envioGratis: true, aviso: "El descuento no se suma a productos con precio promocional." }));
    expect(h).toContain("Envío gratis (cupón)");
    expect(h).toContain("El descuento no se suma a productos con precio promocional.");
    expect(h).not.toContain("−");
  });
});

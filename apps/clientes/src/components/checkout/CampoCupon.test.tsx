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

  it("con cupón aplicado y línea propia: sólo Condiciones (el código y la X están en LineaCupon)", () => {
    const h = html({ cupon: "luz-7kq2m", aplicado });
    expect(h).toContain("Condiciones");
    expect(h).not.toContain("LUZ-7KQ2M</span>");
    expect(h).not.toContain("Quitar el cupón");
  });

  it("con cupón aplicado sin línea (no elegible con este medio): el código y la X", () => {
    const h = html({ cupon: "luz-7kq2m", aplicado: { ...aplicado, descuento: 0, pctAplicado: false, aviso: "Su cupón es válido sólo en 1 pago." } });
    expect(h).toContain("LUZ-7KQ2M");
    expect(h).toContain('aria-label="Quitar el cupón LUZ-7KQ2M"');
  });

  it("con error: el mensaje y Quitar (el cupón queda guardado)", () => {
    const h = html({ cupon: "LUZ-7KQ2M", error: { motivo: "vencido", mensaje: "Este cupón venció." } });
    expect(h).toContain("Este cupón venció.");
    expect(h).toContain('aria-label="Quitar el cupón LUZ-7KQ2M"');
  });

  it("el formato válido es el del carrito: menos de 4 letras o números no llega al servidor", async () => {
    const { limpiarCupon } = await import("@/lib/carrito-cliente");
    expect(limpiarCupon("jbj")).toBeNull();
    expect(limpiarCupon("jbjx")).toBe("jbjx");
  });
});

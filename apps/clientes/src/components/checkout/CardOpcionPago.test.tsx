import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MedioPago } from "@/lib/medios-pago";
import { CardOpcionPago } from "./CardOpcionPago";

const medio = { slug: "transferencia", nombre: "Transferencia", instrucciones: "", chips: [] } as unknown as MedioPago;
const html = (cuponNoAplica?: boolean) =>
  renderToStaticMarkup(
    <CardOpcionPago
      opcion={{ clave: "transferencia", slug: "transferencia", forma: null }}
      medio={medio}
      titulo="Transferencia"
      selected={false}
      onClick={() => {}}
      total={900}
      textoAhorro={null}
      {...(cuponNoAplica !== undefined ? { cuponNoAplica } : {})}
    />,
  );

describe("CardOpcionPago con cupón", () => {
  it("no aplica: línea gris; aplica: chip Con su cupón; sin cupón: nada", () => {
    expect(html(true)).toContain("El cupón no aplica con este medio");
    expect(html(false)).toContain("Con su cupón");
    expect(html(false)).not.toContain("El cupón no aplica");
    expect(html()).not.toContain("cupón");
  });
});

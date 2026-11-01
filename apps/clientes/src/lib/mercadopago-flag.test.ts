import { describe, expect, it } from "vitest";
import { setFlag } from "@/test/flags";
import { mediosSegunComprador, mediosSegunPublico } from "./mercadopago-flag";

const medios = [{ slug: "transferencia" }, { slug: "mercadopago" }, { slug: "payway" }];

describe("flag mercadopago", () => {
  it("prendido: deja los medios como están", async () => {
    setFlag("mercadopago", true);
    expect(await mediosSegunComprador(medios)).toEqual(medios);
    expect(await mediosSegunPublico(medios)).toEqual(medios);
  });

  it("apagado: saca sólo Mercado Pago", async () => {
    setFlag("mercadopago", false);
    const esperado = [{ slug: "transferencia" }, { slug: "payway" }];
    expect(await mediosSegunComprador(medios)).toEqual(esperado);
    expect(await mediosSegunPublico(medios)).toEqual(esperado);
  });

  it("sin Mercado Pago en la lista no evalúa nada y devuelve una copia", async () => {
    setFlag("mercadopago", false);
    const otros = [{ slug: "transferencia" }];
    const r = await mediosSegunComprador(otros);
    expect(r).toEqual(otros);
    expect(r).not.toBe(otros);
  });
});

import { describe, expect, it } from "vitest";
import type { MedioPago } from "./medios-pago";
import { ahorroFrente, bajadaOpcion, listaDeOpcion, tituloEnFrase, opcionElegida, opcionesDePago, textoConfirmar, tituloOpcion } from "./opciones-pago";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "transferencia",
  nombre: "Transferencia",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 1,
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

const transferencia = medio({});
const mp = medio({ slug: "mercadopago", nombre: "Mercado Pago", cobroOnline: true });
const payway = medio({ slug: "payway", nombre: "Payway", cobroOnline: true });

describe("opcionesDePago", () => {
  it("abre Mercado Pago en cuenta, crédito y débito, en ese orden", () => {
    expect(opcionesDePago([transferencia, mp]).map((o) => o.clave)).toEqual([
      "transferencia",
      "mercadopago:cuenta_mp",
      "mercadopago:credito",
      "mercadopago:debito",
    ]);
  });

  it("respeta las formas que habilitó el admin", () => {
    const soloCuenta = medio({ ...mp, opcionesCobro: ["cuenta_mp"] });
    expect(opcionesDePago([soloCuenta]).map((o) => o.forma)).toEqual(["cuenta_mp"]);
  });

  it("con Mercado Pago y Payway, las tarjetas van por Mercado Pago", () => {
    expect(opcionesDePago([payway, mp]).map((o) => o.clave)).toEqual([
      "mercadopago:cuenta_mp",
      "mercadopago:credito",
      "mercadopago:debito",
    ]);
  });

  it("Payway aporta la tarjeta que Mercado Pago no ofrece", () => {
    const mpSinDebito = medio({ ...mp, opcionesCobro: ["cuenta_mp", "credito"] });
    expect(opcionesDePago([mpSinDebito, payway]).map((o) => o.clave)).toEqual([
      "mercadopago:cuenta_mp",
      "mercadopago:credito",
      "payway:debito",
    ]);
  });

  it("sólo Payway: crédito y débito", () => {
    expect(opcionesDePago([payway]).map((o) => o.clave)).toEqual(["payway:credito", "payway:debito"]);
  });
});

describe("opcionElegida", () => {
  const opciones = opcionesDePago([transferencia, mp]);
  it("la elegida si sigue disponible", () => {
    expect(opcionElegida(opciones, "mercadopago:debito")?.forma).toBe("debito");
  });
  it("la primera si no", () => {
    expect(opcionElegida(opciones, "payway:credito")?.clave).toBe("transferencia");
    expect(opcionElegida([], "x")).toBeNull();
  });
});

describe("listaDeOpcion", () => {
  const conFormas = medio({ ...mp, idListaPrecios: "L", listasPorForma: { debito: "D" } });
  it("la lista de la forma, si no la del medio, si no la general", () => {
    expect(listaDeOpcion([conFormas], { clave: "", slug: "mercadopago", forma: "debito" })).toBe("D");
    expect(listaDeOpcion([conFormas], { clave: "", slug: "mercadopago", forma: "credito" })).toBe("L");
    expect(listaDeOpcion([transferencia], { clave: "", slug: "transferencia", forma: null })).toBe("");
  });
});

describe("textos", () => {
  it("título y botón según la forma", () => {
    expect(tituloOpcion({ clave: "", slug: "mercadopago", forma: "cuenta_mp" }, "Mercado Pago")).toBe("Mercado Pago");
    expect(tituloOpcion({ clave: "", slug: "transferencia", forma: null }, "Transferencia")).toBe("Transferencia");
    expect(textoConfirmar({ clave: "", slug: "mercadopago", forma: "cuenta_mp" })).toBe("Ir a Mercado Pago");
    expect(textoConfirmar({ clave: "", slug: "payway", forma: "debito" })).toBe("Continuar con débito");
    expect(textoConfirmar(null)).toBe("Confirmar pedido");
  });
});

describe("ahorroFrente", () => {
  const opciones = opcionesDePago([transferencia, mp]);
  const totales = {
    transferencia: 133_900,
    "mercadopago:cuenta_mp": 144_700,
    "mercadopago:credito": 152_300,
    "mercadopago:debito": 144_700,
  };
  it("frente a la más cara de las otras", () => {
    expect(ahorroFrente(totales, opciones, "transferencia")).toEqual({
      monto: 18_400,
      frente: { clave: "mercadopago:credito", slug: "mercadopago", forma: "credito" },
    });
  });
  it("null si es la más cara o falta su total", () => {
    expect(ahorroFrente(totales, opciones, "mercadopago:credito")).toBeNull();
    expect(ahorroFrente({ ...totales, transferencia: null }, opciones, "transferencia")).toBeNull();
  });
  it("null si la diferencia es de redondeo", () => {
    expect(ahorroFrente({ a: 100, b: 100.4 }, [{ clave: "a", slug: "a", forma: null }, { clave: "b", slug: "b", forma: null }], "a")).toBeNull();
  });
});

describe("tituloEnFrase y bajadaOpcion", () => {
  it("en minúscula salvo Mercado Pago", () => {
    expect(tituloEnFrase({ clave: "", slug: "transferencia", forma: null }, "Transferencia")).toBe("transferencia");
    expect(tituloEnFrase({ clave: "", slug: "mercadopago", forma: "credito" }, "Mercado Pago")).toBe("tarjeta de crédito");
    expect(tituloEnFrase({ clave: "", slug: "mercadopago", forma: "cuenta_mp" }, "Mercado Pago")).toBe("Mercado Pago");
  });
  it("bajada de la cuenta de Mercado Pago y de la transferencia", () => {
    expect(bajadaOpcion({ clave: "", slug: "transferencia", forma: null })).toBe("Le enviamos los datos de la cuenta al confirmar");
    expect(bajadaOpcion({ clave: "", slug: "efectivo", forma: null })).toBeUndefined();
  });
});

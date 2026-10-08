import { describe, expect, it } from "vitest";
import type { OpcionCuotasPedido } from "./cuotas-pedido";
import {
  avisoConInteres,
  eleccionVigente,
  etiquetaOpcion,
  filasSelectorCuotas,
  hayQueRecongelar,
  opcionesDeRespaldo,
  resumenCuotas,
  textoBotonPagar,
  textoRestringidas,
  tituloCuotas,
} from "./cuotas-formulario";

const $ = (s: string) => s.replace(/\s/g, " ");

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

describe("etiquetas del desplegable", () => {
  it("todas con el formato 'N cuotas de $X' y '1 pago de $X'", () => {
    expect($(etiquetaOpcion(unPago))).toMatch(/^1 pago de \$ ?50\.000,00$/);
    expect($(etiquetaOpcion(tres))).toMatch(/^3 cuotas de \$ ?18\.000,00$/);
    expect($(etiquetaOpcion(seis))).toMatch(/^6 cuotas de \$ ?11\.000,00$/);
  });

  it("en orden de cuotas, chip 'Sin interés' sólo en las sin interés", () => {
    const filas = filasSelectorCuotas([seis, unPago, tres]);
    expect(filas.map((f) => f.value)).toEqual(["un_pago-1", "sin_interes-3", "con_interes-6"]);
    expect(filas.map((f) => f.badge?.label ?? null)).toEqual([null, "Sin interés", null]);
    expect(filas[1].badge?.tone).toBe("success");
  });

  it("título con la marca de la tarjeta cargada", () => {
    expect(tituloCuotas(null)).toBe("Cuotas");
    expect(tituloCuotas({ id: null })).toBe("Cuotas");
    expect(tituloCuotas({ id: "visa", nombre: "Visa" })).toBe("Cuotas con su Visa");
  });
});

describe("aviso de la financiación", () => {
  it("sólo con una cuota con interés, con el CFT/TEA informado y el procesador del medio", () => {
    expect(avisoConInteres(unPago, "Mercado Pago")).toBeNull();
    expect(avisoConInteres(tres, "Mercado Pago")).toBeNull();
    expect(avisoConInteres(seis, "Mercado Pago")).toBe(
      "CFT 169,00% · TEA 130,00%. Las cuotas con interés las financia Mercado Pago.",
    );
    expect(avisoConInteres(seis, "Payway")).toContain("las financia Payway");
  });

  it("sin cifras inventadas: lo que no informa el procesador no se muestra", () => {
    const sinTea = { ...seis, tea: undefined };
    expect(avisoConInteres(sinTea, "Mercado Pago")).toBe("CFT 169,00%. Las cuotas con interés las financia Mercado Pago.");
    expect(avisoConInteres({ ...seis, cft: undefined, tea: undefined }, "Mercado Pago")).toBe(
      "Las cuotas con interés las financia Mercado Pago.",
    );
  });
});

describe("cuotas restringidas a algunas tarjetas", () => {
  it("agrupa las cantidades con las mismas marcas", () => {
    expect(textoRestringidas([])).toEqual([]);
    expect(
      textoRestringidas([
        { cuotas: 6, marcas: ["visa", "mastercard"] },
        { cuotas: 12, marcas: ["visa", "mastercard"] },
        { cuotas: 9, marcas: ["naranja"] },
      ]),
    ).toEqual(["6 y 12 cuotas sin interés: sólo con Visa y Mastercard.", "9 cuotas sin interés: sólo con Naranja."]);
    expect(textoRestringidas([{ cuotas: 3, marcas: ["visa", "mastercard", "amex"] }])).toEqual([
      "3 cuotas sin interés: sólo con Visa, Mastercard y American Express.",
    ]);
  });
});

describe("eleccionVigente", () => {
  it("la elegida si sigue entre las opciones (con sus montos nuevos)", () => {
    const nuevaTres = { ...tres, montoCuota: 18500 };
    expect(eleccionVigente([unPago, nuevaTres], "sin_interes-3")).toBe(nuevaTres);
  });
  it("si dejó de ofrecerse (otra tarjeta, control de interés), vuelve a 1 pago", () => {
    expect(eleccionVigente([unPago, seis], "sin_interes-3")).toBe(unPago);
    expect(eleccionVigente([unPago], "con_interes-6")).toBe(unPago);
  });
  it("sin elección todavía: 1 pago", () => {
    expect(eleccionVigente([unPago, tres], null)).toBe(unPago);
  });
});

describe("botón Pagar", () => {
  it("1 pago: 'Pagar $X'", () => {
    const t = textoBotonPagar(unPago);
    expect($(t.largo)).toMatch(/^Pagar \$ ?50\.000,00$/);
    expect(t.corto).toBe(t.largo);
  });
  it("en cuotas: 'Pagar en N cuotas de $X' y en el celular 'Pagar N × $X'", () => {
    const t = textoBotonPagar(seis);
    expect($(t.largo)).toMatch(/^Pagar en 6 cuotas de \$ ?11\.000,00$/);
    expect($(t.corto)).toMatch(/^Pagar 6 × \$ ?11\.000,00$/);
    expect($(textoBotonPagar(tres).largo)).toMatch(/^Pagar en 3 cuotas de \$ ?18\.000,00$/);
  });
});

describe("resumen lateral", () => {
  it("con interés: precio en 1 pago, interés de la financiación y total (coincide con el botón)", () => {
    const r = resumenCuotas(seis, 50000);
    expect(r).toEqual({
      total: 66000,
      precioUnPago: 50000,
      interes: 16000,
      linea: { texto: expect.stringMatching(/^6 cuotas de \$\s?11\.000,00$/), sinInteres: false },
    });
  });
  it("sin interés: sin línea de interés, con las cuotas en verde", () => {
    const r = resumenCuotas(tres, 50000);
    expect(r.total).toBe(54000);
    expect(r.interes).toBeUndefined();
    expect(r.precioUnPago).toBeUndefined();
    expect($(r.linea!.texto)).toMatch(/^3 cuotas sin interés de \$ ?18\.000,00$/);
    expect(r.linea!.sinInteres).toBe(true);
  });
  it("1 pago: sólo el total", () => {
    expect(resumenCuotas(unPago, 50000)).toEqual({ total: 50000 });
  });
});

describe("hayQueRecongelar", () => {
  it("sólo si la opción pide otras cuotas que las del pedido (null = 1 pago)", () => {
    expect(hayQueRecongelar(1, null)).toBe(false);
    expect(hayQueRecongelar(1, 1)).toBe(false);
    expect(hayQueRecongelar(3, 3)).toBe(false);
    expect(hayQueRecongelar(3, null)).toBe(true);
    expect(hayQueRecongelar(1, 6)).toBe(true);
  });
});

describe("opcionesDeRespaldo (no se pudieron consultar las cuotas)", () => {
  it("1 pago con el total del pedido", () => {
    expect(opcionesDeRespaldo({ cuotas: null, total: 50000 })).toEqual([unPago]);
    expect(opcionesDeRespaldo({ cuotas: 1, total: 50000 })).toEqual([unPago]);
  });
  it("pedido ya congelado sin interés: esas cuotas, que el servidor acepta", () => {
    expect(opcionesDeRespaldo({ cuotas: 3, total: 54000 })).toEqual([{ ...tres }]);
  });
});

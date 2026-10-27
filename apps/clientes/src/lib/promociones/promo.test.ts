import { describe, expect, it } from "vitest";
import {
  LEGALES_DEFAULT,
  aIsoArgentina,
  datosPromoCliente,
  infoPromoDe,
  deIsoArgentina,
  esUltimas,
  estadoPromo,
  fechaCortaAR,
  porcentajeAhorro,
  precioPrincipal,
  restante,
  skusPromo,
  textoLegales,
  unidadesQuedan,
} from "./promo";

const FIN = "2026-11-13T23:59:00-03:00";

describe("estadoPromo", () => {
  const base = { fin: FIN, items: [{ sku: "A" }] };

  it("vigente un segundo antes del fin", () => {
    expect(estadoPromo(base, Date.parse("2026-11-13T23:58:59-03:00"))).toBe("vigente");
  });

  it("terminada justo en el fin (borde exclusivo)", () => {
    expect(estadoPromo(base, Date.parse(FIN))).toBe("terminada");
  });

  it("programada con inicio futuro", () => {
    const p = { ...base, inicio: "2026-11-03T00:00:00-03:00" };
    expect(estadoPromo(p, Date.parse("2026-11-02T23:00:00-03:00"))).toBe("programada");
  });

  it("inactiva sin fin", () => {
    expect(estadoPromo({ items: [{ sku: "A" }] }, Date.parse("2026-11-05T00:00:00-03:00"))).toBe("inactiva");
  });

  it("inactiva sin estrella ni items", () => {
    expect(estadoPromo({ fin: FIN, items: [] }, Date.parse("2026-11-05T00:00:00-03:00"))).toBe("inactiva");
  });

  it("vigente con sólo la estrella", () => {
    expect(estadoPromo({ fin: FIN, estrella: { sku: "E" }, items: [] }, Date.parse("2026-11-05T00:00:00-03:00"))).toBe(
      "vigente",
    );
  });
});

describe("unidadesQuedan", () => {
  const e = { unidadesPromo: 5, stockBase: 10 };

  it.each([
    [10, 5],
    [8, 3],
    [5, 0],
    [3, 0],
  ])("con stock %i quedan %i", (stock, quedan) => {
    expect(unidadesQuedan(e, stock)).toBe(quedan);
  });

  it("una reposición no supera las unidades de promo", () => {
    expect(unidadesQuedan(e, 14)).toBe(5);
  });

  it("sin fila de stock en la sucursal cuenta como 0", () => {
    expect(unidadesQuedan(e, null)).toBe(0);
  });

  it("sin unidades de promo no hay contador", () => {
    expect(unidadesQuedan({ stockBase: 10 }, 8)).toBeNull();
  });
});

describe("esUltimas", () => {
  it.each([
    [2, true],
    [1, true],
    [0, false],
    [3, false],
    [null, false],
  ] as const)("%s → %s", (quedan, esperado) => {
    expect(esUltimas(quedan)).toBe(esperado);
  });
});

describe("porcentajeAhorro", () => {
  it("redondea hacia abajo", () => {
    expect(porcentajeAhorro(109999, 150000)).toBe(26);
  });
  it("sin ahorro si la referencia es igual", () => {
    expect(porcentajeAhorro(150000, 150000)).toBeNull();
  });
  it("sin ahorro si la referencia es menor", () => {
    expect(porcentajeAhorro(160000, 150000)).toBeNull();
  });
  it("sin referencia", () => {
    expect(porcentajeAhorro(100000)).toBeNull();
  });
});

describe("precioPrincipal", () => {
  it("usa el precio por transferencia con IVA", () => {
    expect(
      precioPrincipal({ price: 100, precioFinal: 121, precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 80, precioFinal: 96.8 } }),
    ).toEqual({ monto: 96.8, esTransferencia: true });
  });
  it("sin precio de medio usa el de lista", () => {
    expect(precioPrincipal({ price: 100, precioFinal: 121 })).toEqual({ monto: 121, esTransferencia: false });
  });
  it("sin IVA conocido usa el neto", () => {
    expect(precioPrincipal({ price: 100 })).toEqual({ monto: 100, esTransferencia: false });
  });
});

describe("skusPromo", () => {
  it("normaliza, pone la estrella primero y saca repetidos", () => {
    expect(skusPromo({ estrella: { sku: " nk-1 " }, items: [{ sku: "NK-1" }, { sku: "b" }] })).toEqual(["NK-1", "B"]);
  });
});

describe("fechas en hora de Argentina", () => {
  it("aIsoArgentina agrega el offset -03:00", () => {
    expect(aIsoArgentina("2026-11-13T23:59")).toBe("2026-11-13T23:59:00-03:00");
  });
  it("deIsoArgentina es la inversa", () => {
    expect(deIsoArgentina(aIsoArgentina("2026-11-13T23:59"))).toBe("2026-11-13T23:59");
  });
  it("deIsoArgentina convierte desde UTC", () => {
    expect(deIsoArgentina("2026-11-14T02:59:00Z")).toBe("2026-11-13T23:59");
  });
  it("fechaCortaAR", () => {
    expect(fechaCortaAR("2026-11-14T02:59:00Z")).toBe("13/11");
  });
});

describe("textoLegales", () => {
  it("reemplaza inicio, fin y unidades", () => {
    expect(textoLegales(LEGALES_DEFAULT, { inicio: "2026-11-03T00:00:00-03:00", fin: FIN, unidades: 5 })).toBe(
      "Promoción válida del 3/11 al 13/11 o hasta agotar 5 unidades del producto estrella. Precios finales con IVA para pago por transferencia. Stock sujeto a disponibilidad.",
    );
  });
});

describe("restante", () => {
  it("días, horas, minutos y segundos hasta el fin", () => {
    const ahora = Date.parse(FIN) - ((1 * 24 + 4) * 3600 + 12 * 60 + 5) * 1000;
    expect(restante(FIN, ahora)).toEqual({ d: 1, h: 4, m: 12, s: 5 });
  });
  it("null pasado el fin", () => {
    expect(restante(FIN, Date.parse(FIN) + 1)).toBeNull();
  });
});

describe("datosPromoCliente / infoPromoDe", () => {
  const contenido = {
    etiquetaBadge: "Precio de apertura",
    etiquetaReferencia: "En otras tiendas desde",
    legales: LEGALES_DEFAULT,
    fin: FIN,
    estrella: { sku: "nk-1", precioReferencia: 150000, unidadesPromo: 5, stockBase: 10 },
    items: [{ sku: "A1" }],
  };
  const durante = Date.parse("2026-11-05T12:00:00-03:00");

  it("sin fin no hay datos para el cliente", () => {
    expect(datosPromoCliente({ ...contenido, fin: undefined })).toBeNull();
  });

  it("referencias por SKU normalizado", () => {
    const d = datosPromoCliente(contenido)!;
    expect(d.refs).toEqual({ "NK-1": 150000, A1: undefined });
    expect(d.estrellaSku).toBe("NK-1");
  });

  it("info del producto en promo vigente", () => {
    const d = datosPromoCliente(contenido)!;
    expect(infoPromoDe(d, "NK-1", durante)).toMatchObject({ etiquetaBadge: "Precio de apertura", referencia: 150000, esEstrella: true, fin: FIN });
    expect(infoPromoDe(d, "a1", durante)).toMatchObject({ esEstrella: false });
  });

  it("fuera de vigencia o sin SKU, nada", () => {
    const d = datosPromoCliente(contenido)!;
    expect(infoPromoDe(d, "NK-1", Date.parse(FIN))).toBeNull();
    expect(infoPromoDe(d, undefined, durante)).toBeNull();
    expect(infoPromoDe(null, "NK-1", durante)).toBeNull();
  });

  it("sólo por SKU exacto: un nombre igual al SKU no cuenta", () => {
    const d = datosPromoCliente(contenido)!;
    expect(infoPromoDe(d, "NK-10", durante)).toBeNull();
  });
});

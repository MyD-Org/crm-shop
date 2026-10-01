import { describe, expect, it } from "vitest";
import type { AlegraItem, AlegraPrice } from "./alegra";
import { cotizarItem } from "./cotizacion";
import { precioCuenta } from "./precio-cuenta";

/**
 * Qué precio se muestra y qué precio se cobra cuando el cliente tiene una lista
 * propia. El catálogo (`precioCuenta`) sólo la usa si es MÁS BARATA que la
 * general y mayor a 0. La cotización (`cotizarItem` → `resolverPrecio`) tiene
 * que cobrar lo mismo que el catálogo mostró.
 */

const GENERAL: AlegraPrice = { idPriceList: "1", price: 1000, main: true };
const PROPIA = "7";

function item(precios: AlegraPrice[]): AlegraItem {
  return {
    id: "10",
    name: "Producto de prueba",
    status: "active",
    price: precios,
    tax: [{ percentage: 21 }],
  } as AlegraItem;
}

const linea = { id: "10", qty: 1 };

interface Caso {
  nombre: string;
  precios: AlegraPrice[];
  idPriceList: string | undefined;
  /** Precio neto esperado: el que muestra el catálogo y debería cobrar la cotización. */
  esperado: number;
  /** ¿Es precio especial de la cuenta (tachado en el catálogo)? */
  especial: boolean;
}

const casos: Caso[] = [
  {
    nombre: "lista propia más barata → se usa",
    precios: [GENERAL, { idPriceList: PROPIA, price: 800 }],
    idPriceList: PROPIA,
    esperado: 800,
    especial: true,
  },
  {
    nombre: "sin lista propia asignada → precio general",
    precios: [GENERAL, { idPriceList: PROPIA, price: 800 }],
    idPriceList: undefined,
    esperado: 1000,
    especial: false,
  },
  {
    nombre: "lista asignada que el producto no tiene → precio general",
    precios: [GENERAL],
    idPriceList: PROPIA,
    esperado: 1000,
    especial: false,
  },
];

/** Divergencias conocidas: la lista propia pisa al general aunque sea más cara o 0. */
const casosConBug: Caso[] = [
  {
    nombre: "lista propia más cara → precio general",
    precios: [GENERAL, { idPriceList: PROPIA, price: 1200 }],
    idPriceList: PROPIA,
    esperado: 1000,
    especial: false,
  },
  {
    nombre: "lista propia en 0 → precio general",
    precios: [GENERAL, { idPriceList: PROPIA, price: 0 }],
    idPriceList: PROPIA,
    esperado: 1000,
    especial: false,
  },
];

describe("precio de la lista propia en el catálogo (precioCuenta)", () => {
  it.each([...casos, ...casosConBug])("$nombre", ({ precios, idPriceList, esperado, especial }) => {
    const r = precioCuenta(precios, 21, idPriceList);
    if (especial) expect(r?.price).toBe(esperado);
    else expect(r).toBeNull(); // sin precio especial: el catálogo muestra el general
  });

  it("igual al general → no es precio especial", () => {
    expect(precioCuenta([GENERAL, { idPriceList: PROPIA, price: 1000 }], 21, PROPIA)).toBeNull();
  });

  it("lista propia ausente de los precios del producto → null", () => {
    expect(precioCuenta([GENERAL], 21, PROPIA)).toBeNull();
    expect(precioCuenta([], 21, PROPIA)).toBeNull();
    expect(precioCuenta(undefined, 21, PROPIA)).toBeNull();
  });
});

describe("precio de la lista propia en la cotización (cotizarItem)", () => {
  it.each(casos)("$nombre", ({ precios, idPriceList, esperado, especial }) => {
    const l = cotizarItem(linea, item(precios), idPriceList);
    expect(l.precioUnitario).toBe(esperado);
    expect(Boolean(l.precioEspecial)).toBe(especial);
    expect(l.problema).toBeUndefined();
  });

  it("lista propia más cara → cobra el precio general, como el catálogo", () => {
    const l = cotizarItem(linea, item(casosConBug[0].precios), PROPIA);
    expect(l.precioUnitario).toBe(1000);
  });

  it("lista propia en 0 → cobra el precio general, no 'sin_precio'", () => {
    const l = cotizarItem(linea, item(casosConBug[1].precios), PROPIA);
    expect(l.precioUnitario).toBe(1000);
    expect(l.problema).toBeUndefined();
  });

  it("lista propia más cara no marca precio especial (coincide con el catálogo)", () => {
    const l = cotizarItem(linea, item(casosConBug[0].precios), PROPIA);
    expect(l.precioEspecial).toBeUndefined();
  });

  it("catálogo y cotización coinciden en el precio cuando hay precio especial", () => {
    const precios = [GENERAL, { idPriceList: PROPIA, price: 800 }];
    const vista = precioCuenta(precios, 21, PROPIA);
    expect(cotizarItem(linea, item(precios), PROPIA).precioUnitario).toBe(vista?.price);
  });
});

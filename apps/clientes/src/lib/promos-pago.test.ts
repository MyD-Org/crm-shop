import { describe, expect, it } from "vitest";
import type { Product } from "@/data/products";
import { descuentoDelMedio, mejorCuotas, promosPago } from "./promos-pago";

const prod = (price: number, medio?: number, extra: Partial<Product> = {}): Product =>
  ({
    id: String(Math.random()),
    name: "x",
    brand: "x",
    price,
    stock: "in",
    ...(medio != null ? { precioMedio: { slug: "transferencia", nombre: "Transferencia", price: medio } } : {}),
    ...extra,
  }) as Product;

const transferencia = { slug: "transferencia", nombre: "Transferencia", idListaPrecios: "l1" };

describe("mejorCuotas", () => {
  it("toma la mayor cantidad entre todos los medios", () => {
    expect(
      mejorCuotas([
        { slug: "payway", nombre: "Payway", condiciones: [{ cuotas: 3, idListaPrecios: "a" }] },
        { slug: "mercadopago", nombre: "Mercado Pago", condiciones: [{ cuotas: 6, idListaPrecios: "b" }] },
      ]),
    ).toEqual({ cuotas: 6, medio: "Mercado Pago", minimo: null });
  });

  it("con la misma cantidad prefiere la condición sin mínimo", () => {
    expect(
      mejorCuotas([
        { slug: "a", nombre: "A", condiciones: [{ cuotas: 6, idListaPrecios: "a", montoMinimo: 50_000 }] },
        { slug: "b", nombre: "B", condiciones: [{ cuotas: 6, idListaPrecios: "b" }] },
      ]),
    ).toEqual({ cuotas: 6, medio: "B", minimo: null });
  });

  it("sin medios o con 1 pago no hay cuotas", () => {
    expect(mejorCuotas(undefined)).toBeNull();
    expect(mejorCuotas([{ slug: "a", nombre: "A", condiciones: [{ cuotas: 1, idListaPrecios: "a" }] }])).toBeNull();
  });
});

describe("descuentoDelMedio", () => {
  it("deduce el porcentaje que comparten los productos", () => {
    const productos = [prod(100, 90), prod(200, 180), prod(1000, 900), prod(50, 40)];
    expect(descuentoDelMedio(productos, "transferencia")).toEqual({ hay: true, porcentaje: 10 });
  });

  it("sin mayoría no afirma un porcentaje", () => {
    const productos = [prod(100, 90), prod(100, 80), prod(100, 70)];
    expect(descuentoDelMedio(productos, "transferencia")).toEqual({ hay: true, porcentaje: null });
  });

  it("con muestra chica no afirma un porcentaje", () => {
    expect(descuentoDelMedio([prod(100, 90), prod(100, 90)], "transferencia").porcentaje).toBeNull();
  });

  it("ignora productos en campaña, de otro medio o sin descuento", () => {
    const campania = { campania: { id: "c", nombre: "c", etiqueta: "c", fin: "2026-12-01T00:00:00Z" } } as Partial<Product>;
    const productos = [prod(100, 50, campania), prod(100), prod(100, 100)];
    expect(descuentoDelMedio(productos, "transferencia")).toEqual({ hay: false, porcentaje: null });
    expect(descuentoDelMedio([prod(100, 90)], "otro").hay).toBe(false);
  });
});

describe("promosPago", () => {
  const productos = [prod(100, 90), prod(200, 180), prod(1000, 900)];

  it("arma el aviso de cuotas y el de descuento", () => {
    expect(
      promosPago({
        cuotas: [{ slug: "mercadopago", nombre: "Mercado Pago", condiciones: [{ cuotas: 6, idListaPrecios: "b" }] }],
        destacado: transferencia,
        productos,
      }),
    ).toEqual([
      { tipo: "cuotas", titulo: "Hasta 6 cuotas sin interés", texto: "Con tarjeta de crédito a través de Mercado Pago." },
      { tipo: "descuento", titulo: "10 % de descuento", texto: "Pagando con Transferencia." },
    ]);
  });

  it("menciona el mínimo de compra de las cuotas", () => {
    const [aviso] = promosPago({
      cuotas: [{ slug: "p", nombre: "Payway", condiciones: [{ cuotas: 3, idListaPrecios: "a", montoMinimo: 50_000 }] }],
      productos: [],
    });
    expect(aviso.texto).toMatch(/^Con tarjeta de crédito a través de Payway\. En compras desde \$\s?50\.000\.$/);
  });

  it("rotula la forma de pago cuando el precio es de una forma", () => {
    const conForma = [100, 200, 300].map((n) =>
      prod(n, undefined, { precioMedio: { slug: "mercadopago", nombre: "Mercado Pago", price: n * 0.95, forma: "debito" } }),
    );
    const [aviso] = promosPago({ destacado: { ...transferencia, slug: "mercadopago", nombre: "Mercado Pago" }, productos: conForma });
    expect(aviso).toEqual({ tipo: "descuento", titulo: "5 % de descuento", texto: "Pagando con tarjeta de débito." });
  });

  it("sin porcentaje anuncia el medio", () => {
    const [aviso] = promosPago({ destacado: transferencia, productos: [prod(100, 90)] });
    expect(aviso.titulo).toBe("Mejor precio con Transferencia");
  });

  it("sin cuotas ni descuento no hay avisos", () => {
    expect(promosPago({ destacado: transferencia, productos: [prod(100)] })).toEqual([]);
    expect(promosPago({ productos })).toEqual([]);
  });
});

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
  it("toma el mayor descuento, redondeado hacia abajo", () => {
    expect(descuentoDelMedio([prod(100, 90), prod(100, 80), prod(1000, 805)], "transferencia")).toEqual({ hay: true, maximo: 20 });
    const conForma = prod(100, undefined, { precioMedio: { slug: "mp", nombre: "Mercado Pago", price: 95, forma: "debito" } });
    expect(descuentoDelMedio([conForma], "mp")).toEqual({ hay: true, maximo: 5, forma: "debito" });
  });

  it("ignora productos en campaña, de otro medio o sin descuento", () => {
    const campania = { campania: { id: "c", nombre: "c", etiqueta: "c", fin: "2026-12-01T00:00:00Z" } } as Partial<Product>;
    const productos = [prod(100, 50, campania), prod(100), prod(100, 100), prod(1000, 999)];
    expect(descuentoDelMedio(productos, "transferencia")).toEqual({ hay: false, maximo: 0 });
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
      { tipo: "cuotas", cuotas: 6, titulo: "Hasta 6 cuotas sin interés", texto: "Con tarjeta de crédito." },
      { tipo: "descuento", titulo: "Grandes descuentos", texto: "Pagando con Transferencia." },
    ]);
  });

  it("menciona el mínimo de compra de las cuotas", () => {
    const [aviso] = promosPago({
      cuotas: [{ slug: "p", nombre: "Payway", condiciones: [{ cuotas: 3, idListaPrecios: "a", montoMinimo: 50_000 }] }],
      productos: [],
    });
    expect(aviso.texto).toMatch(/^Con tarjeta de crédito\. En compras desde \$\s?50\.000\.$/);
  });

  it("rotula la forma de pago cuando el precio es de una forma", () => {
    const conForma = [100, 200, 300].map((n) =>
      prod(n, undefined, { precioMedio: { slug: "mercadopago", nombre: "Mercado Pago", price: n * 0.95, forma: "debito" } }),
    );
    const [aviso] = promosPago({ destacado: { ...transferencia, slug: "mercadopago", nombre: "Mercado Pago" }, productos: conForma });
    expect(aviso).toEqual({ tipo: "descuento", titulo: "Grandes descuentos", texto: "Pagando con tarjeta de débito." });
  });

  it("usa los textos del editor, pero el número y el mínimo siguen siendo los reales", () => {
    const avisos = promosPago({
      cuotas: [{ slug: "mp", nombre: "Mercado Pago", condiciones: [{ cuotas: 6, idListaPrecios: "b", montoMinimo: 50_000 }] }],
      destacado: transferencia,
      productos,
      textos: { cuotasTexto: "Con todas las tarjetas", descuentoTitulo: "Ahorre más", descuentoTexto: "Pagando por transferencia." },
    });
    expect(avisos[0].titulo).toBe("Hasta 6 cuotas sin interés");
    expect(avisos[0].texto).toMatch(/^Con todas las tarjetas\. En compras desde \$\s?50\.000\.$/);
    expect(avisos[1]).toEqual({ tipo: "descuento", titulo: "Ahorre más", texto: "Pagando por transferencia." });
  });

  it("textos en blanco vuelven al de por defecto", () => {
    const [aviso] = promosPago({ destacado: transferencia, productos, textos: { descuentoTitulo: "  ", descuentoTexto: "" } });
    expect(aviso).toEqual({ tipo: "descuento", titulo: "Grandes descuentos", texto: "Pagando con Transferencia." });
  });

  it("sin cuotas ni descuento no hay avisos", () => {
    expect(promosPago({ destacado: transferencia, productos: [prod(100)] })).toEqual([]);
    expect(promosPago({ productos })).toEqual([]);
  });
});

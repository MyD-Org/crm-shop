import { describe, expect, it } from "vitest";
import type { PrecioMedio } from "@/data/products";
import { preciosFormaDelModal } from "./precios-forma-modal";

const p = (forma: PrecioMedio["forma"], precioFinal: number, slug = "mercadopago"): PrecioMedio => ({
  slug,
  nombre: slug,
  price: precioFinal / 1.21,
  precioFinal,
  ...(forma ? { forma } : {}),
});

describe("preciosFormaDelModal", () => {
  it("sin líneas por forma: null", () => {
    expect(preciosFormaDelModal(undefined, 1000)).toBeNull();
    expect(preciosFormaDelModal([], 1000)).toBeNull();
    expect(preciosFormaDelModal([p(undefined, 900)], 1000)).toBeNull();
  });

  it("débito más barato que el contado: dos precios", () => {
    expect(preciosFormaDelModal([p("debito", 900)], 1000)).toEqual({ debito: 900, credito: 1000 });
  });

  it("usa la línea de crédito si existe", () => {
    expect(preciosFormaDelModal([p("credito", 950), p("debito", 900)], 1000)).toEqual({ debito: 900, credito: 950 });
  });

  it("mismo precio: null", () => {
    expect(preciosFormaDelModal([p("credito", 900), p("debito", 900)], 1000)).toBeNull();
  });

  it("con débito en dos procesadores toma el menor", () => {
    expect(preciosFormaDelModal([p("debito", 920), p("debito", 900, "payway")], 1000)).toEqual({
      debito: 900,
      credito: 1000,
    });
  });
});

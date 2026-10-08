import { describe, expect, it } from "vitest";
import { tarjetasDeMercadoPago } from "./tarjetas-aceptadas";

const medio = (id: string, name: string, payment_type_id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  payment_type_id,
  status: "active",
  secure_thumbnail: `https://img.example/${id}.gif`,
  ...extra,
});

describe("tarjetasDeMercadoPago", () => {
  it("separa crédito y débito, con las más usadas primero", () => {
    const t = tarjetasDeMercadoPago([
      medio("naranja", "Naranja", "credit_card"),
      medio("visa", "Visa", "credit_card"),
      medio("argencard", "Argencard", "credit_card"),
      medio("maestro", "Maestro", "debit_card"),
      medio("debvisa", "Visa Débito", "debit_card"),
    ]);
    expect(t.credito.map((x) => x.nombre)).toEqual(["Visa", "Naranja", "Argencard"]);
    expect(t.debito.map((x) => x.nombre)).toEqual(["Visa Débito", "Maestro"]);
    expect(t.credito[0].logo).toBe("https://img.example/visa.gif");
  });

  it("descarta inactivas, otros tipos, logos sin https y datos incompletos", () => {
    const t = tarjetasDeMercadoPago([
      medio("visa", "Visa", "credit_card", { status: "deactive" }),
      medio("rapipago", "Rapipago", "ticket"),
      medio("account_money", "Dinero en cuenta", "account_money"),
      medio("master", "Mastercard", "credit_card", { secure_thumbnail: "http://img.example/m.gif" }),
      medio("amex", "", "credit_card"),
      { id: 1 },
      null,
    ]);
    expect(t).toEqual({ credito: [], debito: [] });
  });

  it("una respuesta que no es lista da vacío", () => {
    expect(tarjetasDeMercadoPago({ message: "unauthorized" })).toEqual({ credito: [], debito: [] });
  });
});

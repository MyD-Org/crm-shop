import { describe, expect, it } from "vitest";
import { DETALLE_PROVEEDOR_MAX, errorDeCatch, sanearDetalleProveedor, sanearTexto } from "./detalle-proveedor";
import { ErrorProveedor } from "./tipos";

describe("sanearDetalleProveedor — Mercado Pago", () => {
  it("500 internal_error: conserva message, error, status y cause[].code/description", () => {
    const d = sanearDetalleProveedor({
      message: "internal_error",
      error: "internal_server_error",
      status: 500,
      cause: [{ code: "2001", description: "Error interno del servicio" }],
    });
    expect(d).toContain("internal_error");
    expect(d).toContain("internal_server_error");
    expect(d).toContain("500");
    expect(d).toContain("2001");
    expect(d).toContain("Error interno del servicio");
  });

  it("400: no deja pasar email, token, PAN ni Bearer", () => {
    const d = sanearDetalleProveedor({
      message:
        "Invalid payer comprador@cliente.example token 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d tarjeta 4509953566233704 Authorization: Bearer abc123 y APP_USR-1234-abcd",
      error: "bad_request",
      status: 400,
      cause: [{ code: 4, description: "contacto otro@cliente.example 11 2233 4455" }],
    });
    expect(d).not.toBeNull();
    expect(d).not.toContain("cliente.example");
    expect(d).not.toContain("1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d");
    expect(d).not.toContain("4509953566233704");
    expect(d).not.toContain("abc123");
    expect(d).not.toContain("APP_USR");
    expect(d).toContain("bad_request");
  });

  it("status_detail se conserva", () => {
    expect(sanearDetalleProveedor({ status: "rejected", status_detail: "cc_rejected_other_reason" })).toContain(
      "cc_rejected_other_reason",
    );
  });
});

describe("sanearDetalleProveedor — Payway", () => {
  it("error_type, message y validation_errors[].code/param", () => {
    const d = sanearDetalleProveedor({
      error_type: "invalid_request_error",
      message: "parametro invalido",
      validation_errors: [{ code: "invalid_param", param: "bin" }, { code: "missing_param", param: "amount" }],
    });
    expect(d).toContain("invalid_request_error");
    expect(d).toContain("parametro invalido");
    expect(d).toContain("invalid_param");
    expect(d).toContain("bin");
    expect(d).toContain("amount");
  });
});

describe("sanearDetalleProveedor — límites", () => {
  it("los campos desconocidos no se filtran", () => {
    const d = sanearDetalleProveedor({ message: "boom", secreto: "VALOR-SECRETO-NO-FILTRAR", payer: { email: "x@cliente.example" } });
    expect(d).toContain("boom");
    expect(d).not.toContain("VALOR-SECRETO");
    expect(d).not.toContain("cliente.example");
  });

  it.each([[null], [undefined], ["<html>502</html>"], [42], [[]], [{}], [{ otro: "x" }], [{ message: "   " }]])(
    "cuerpo sin información útil (%j) -> null",
    (cuerpo) => {
      expect(sanearDetalleProveedor(cuerpo)).toBeNull();
    },
  );

  it("trunca a 500 exactos", () => {
    const d = sanearDetalleProveedor({ message: "a b ".repeat(1000) });
    expect(d).not.toBeNull();
    expect(d!.length).toBe(DETALLE_PROVEEDOR_MAX);
    expect(DETALLE_PROVEEDOR_MAX).toBe(500);
  });
});

describe("sanearTexto", () => {
  it("redacta emails, dígitos largos, tokens, Bearer, prefijos y querystrings", () => {
    const t = sanearTexto(
      "mail a@cliente.example dni 12345678 tok ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 Bearer xyz TEST-999-aaa https://api.example/pagos?token=abc&x=1 fin",
    );
    expect(t).not.toContain("cliente.example");
    expect(t).not.toContain("12345678");
    expect(t).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(t).not.toContain("xyz");
    expect(t).not.toContain("TEST-999");
    expect(t).not.toContain("token=abc");
    expect(t).toContain("fin");
  });

  it("deja pasar texto corto inocuo y códigos de menos de 8 dígitos", () => {
    expect(sanearTexto("error 500 en 1234567")).toBe("error 500 en 1234567");
  });

  it("trunca a 500", () => {
    expect(sanearTexto("x ".repeat(600)).length).toBeLessThanOrEqual(500);
  });
});

describe("errorDeCatch", () => {
  it("ErrorProveedor con detalle: usa el detalle y el status", () => {
    expect(errorDeCatch(new ErrorProveedor("Mercado Pago respondió 500", 500, "message: internal_error"))).toEqual({
      detalle: "message: internal_error",
      status: 500,
    });
  });

  it("ErrorProveedor sin detalle: cae al mensaje saneado", () => {
    expect(errorDeCatch(new ErrorProveedor("Mercado Pago respondió 502", 502))).toEqual({
      detalle: "Mercado Pago respondió 502",
      status: 502,
    });
  });

  it("timeout / abortado: texto fijo, sin status", () => {
    expect(errorDeCatch(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }))).toEqual({
      detalle: "tiempo de espera agotado",
      status: null,
    });
    expect(errorDeCatch(Object.assign(new Error("x"), { name: "AbortError" })).detalle).toBe("tiempo de espera agotado");
  });

  it("otro error: sólo el nombre, nunca el mensaje", () => {
    const r = errorDeCatch(new TypeError("select * from orders where email = 'a@cliente.example'"));
    expect(r).toEqual({ detalle: "error_interno: TypeError", status: null });
  });

  it("valor no Error: no explota", () => {
    expect(errorDeCatch("boom").status).toBeNull();
    expect(errorDeCatch(undefined).detalle).toContain("error_interno");
  });
});

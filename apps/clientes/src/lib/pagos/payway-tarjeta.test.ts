import { describe, expect, it } from "vitest";
import {
  armarSolicitudToken,
  cuotasPermitidas,
  marcaPorPrefijo,
  metodoPagoIdDe,
  normalizarPan,
  validarCvv,
  validarDocumento,
  validarPan,
  validarTitular,
  validarVencimiento,
} from "./payway-tarjeta";

// Tarjetas de prueba PÚBLICAS de la documentación de Payway (sandbox). No son tarjetas reales.
const VISA = "4507990000004905";
const VISA_DEBITO = "4517721004856075";
const MASTERCARD = "5299910010000015";
const CABAL = "5896570000000008";

describe("normalizarPan", () => {
  it("saca espacios y guiones", () => {
    expect(normalizarPan("4507 9900-0000 4905")).toBe(VISA);
    expect(normalizarPan("  ")).toBe("");
  });
});

describe("marcaPorPrefijo", () => {
  it.each([
    [VISA, "visa"],
    [VISA_DEBITO, "visa"],
    [MASTERCARD, "mastercard"],
    ["2221000000000009", "mastercard"],
    ["378282246310005", "amex"],
    ["340000000000009", "amex"],
    [CABAL, "cabal"],
    ["36227206271667", "diners"],
    ["5018000000000009", "maestro"],
  ])("%s -> %s", (pan, marca) => {
    expect(marcaPorPrefijo(pan)).toBe(marca);
  });

  it("sin prefijo reconocible no sugiere nada", () => {
    expect(marcaPorPrefijo("")).toBeNull();
    expect(marcaPorPrefijo("9999")).toBeNull();
  });
});

describe("validarPan", () => {
  it("acepta las tarjetas de prueba (Luhn y largo)", () => {
    for (const pan of [VISA, VISA_DEBITO, MASTERCARD, CABAL]) {
      expect(validarPan(pan, marcaPorPrefijo(pan))).toEqual({ ok: true });
    }
    expect(validarPan("378282246310005", "amex")).toEqual({ ok: true });
  });

  it("rechaza Luhn inválido, no numérico y largos fuera de rango", () => {
    expect(validarPan("4507990000004906", "visa").ok).toBe(false);
    expect(validarPan("4507abcd00004905", "visa").ok).toBe(false);
    expect(validarPan("450799", "visa").ok).toBe(false);
    expect(validarPan("", null).ok).toBe(false);
    expect(validarPan("4".repeat(20), null).ok).toBe(false);
  });

  it("exige el largo de la marca: amex 15, visa 16", () => {
    // 4222222222222 pasa Luhn pero una Visa de 13 dígitos no se admite.
    expect(validarPan("4222222222222", "visa").ok).toBe(false);
    expect(validarPan(VISA, "amex").ok).toBe(false);
  });

  it("el mensaje es en usted", () => {
    const r = validarPan("1", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(/Revise|Ingrese/);
  });
});

describe("validarVencimiento", () => {
  const ahora = new Date(2026, 9, 6); // octubre 2026
  it("acepta el mes en curso y los futuros", () => {
    expect(validarVencimiento("10", "26", ahora)).toEqual({ ok: true });
    expect(validarVencimiento("08", "30", ahora)).toEqual({ ok: true });
  });
  it("rechaza vencidas y formatos inválidos", () => {
    expect(validarVencimiento("09", "26", ahora).ok).toBe(false);
    expect(validarVencimiento("12", "25", ahora).ok).toBe(false);
    expect(validarVencimiento("13", "30", ahora).ok).toBe(false);
    expect(validarVencimiento("00", "30", ahora).ok).toBe(false);
    expect(validarVencimiento("1", "3", ahora).ok).toBe(false);
    expect(validarVencimiento("", "", ahora).ok).toBe(false);
  });
  it("acepta el mes de un dígito (lo completa el armado del token)", () => {
    expect(validarVencimiento("8", "30", ahora)).toEqual({ ok: true });
  });
});

describe("validarCvv", () => {
  it("3 dígitos, o 4 en American Express", () => {
    expect(validarCvv("123", "visa")).toEqual({ ok: true });
    expect(validarCvv("1234", "visa").ok).toBe(false);
    expect(validarCvv("1234", "amex")).toEqual({ ok: true });
    expect(validarCvv("123", "amex").ok).toBe(false);
    expect(validarCvv("12a", "visa").ok).toBe(false);
    expect(validarCvv("", null).ok).toBe(false);
  });
  it("sin marca acepta 3 o 4", () => {
    expect(validarCvv("123", null)).toEqual({ ok: true });
    expect(validarCvv("1234", null)).toEqual({ ok: true });
  });
});

describe("validarTitular y validarDocumento", () => {
  it("titular de 1 a 60 caracteres", () => {
    expect(validarTitular("Juan Perez")).toEqual({ ok: true });
    expect(validarTitular("   ").ok).toBe(false);
    expect(validarTitular("a".repeat(61)).ok).toBe(false);
  });
  it("DNI de 7 u 8 dígitos", () => {
    expect(validarDocumento("25123456")).toEqual({ ok: true });
    expect(validarDocumento("25.123.456")).toEqual({ ok: true });
    expect(validarDocumento("123").ok).toBe(false);
    expect(validarDocumento("").ok).toBe(false);
  });
});

describe("metodoPagoIdDe", () => {
  it("combina marca y modalidad (tabla oficial)", () => {
    expect(metodoPagoIdDe("visa", "credito")).toBe(1);
    expect(metodoPagoIdDe("visa", "debito")).toBe(31);
    expect(metodoPagoIdDe("mastercard", "credito")).toBe(104);
    expect(metodoPagoIdDe("cabal", "credito")).toBe(63);
  });
  it("null si la marca no admite esa modalidad o no existe", () => {
    expect(metodoPagoIdDe("amex", "debito")).toBeNull();
    expect(metodoPagoIdDe("inventada", "credito")).toBeNull();
    expect(metodoPagoIdDe(null, "credito")).toBeNull();
  });
});

describe("cuotasPermitidas", () => {
  it("el débito sólo paga en una cuota", () => {
    expect(cuotasPermitidas("debito", 1)).toBe(true);
    expect(cuotasPermitidas("debito", 3)).toBe(false);
    expect(cuotasPermitidas("credito", 3)).toBe(true);
  });
});

describe("armarSolicitudToken", () => {
  it("arma el cuerpo de POST /tokens con mes MM y año YY", () => {
    expect(
      armarSolicitudToken({
        pan: "4507 9900 0000 4905",
        mes: "8",
        anio: "2030",
        cvv: "123",
        titular: "  Juan Perez ",
        nroDoc: "25.123.456",
      }),
    ).toEqual({
      card_number: VISA,
      security_code: "123",
      card_holder_name: "Juan Perez",
      card_expiration_month: "08",
      card_expiration_year: "30",
      card_holder_identification: { type: "dni", number: "25123456" },
    });
  });
});

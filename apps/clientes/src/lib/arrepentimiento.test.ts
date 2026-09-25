import { describe, expect, it } from "vitest";
import {
  LARGOS,
  formatearCodigoArrepentimiento,
  leerCampos,
  llenadoValido,
  validarCampos,
  type CamposArrepentimiento,
} from "./arrepentimiento";

const campos = (extra: Partial<CamposArrepentimiento> = {}): CamposArrepentimiento => ({
  nombre: "Ana Pérez",
  email: "ana@cliente.example",
  telefono: "3757 400000",
  pedido: "",
  motivo: "",
  ...extra,
});

describe("formatearCodigoArrepentimiento", () => {
  it("ARR- con 6 dígitos y ceros a la izquierda, sin truncar", () => {
    expect(formatearCodigoArrepentimiento(42)).toBe("ARR-000042");
    expect(formatearCodigoArrepentimiento(1)).toBe("ARR-000001");
    expect(formatearCodigoArrepentimiento(1234567)).toBe("ARR-1234567");
  });
});

describe("leerCampos", () => {
  it("recorta todo y pasa el email a minúsculas", () => {
    const fd = new FormData();
    fd.set("nombre", "  Ana  ");
    fd.set("email", " Ana@Cliente.EXAMPLE ");
    fd.set("telefono", " 123 ");
    fd.set("pedido", " PED-00001000 ");
    fd.set("motivo", "  No lo necesito ");
    expect(leerCampos(fd)).toEqual({
      nombre: "Ana",
      email: "ana@cliente.example",
      telefono: "123",
      pedido: "PED-00001000",
      motivo: "No lo necesito",
    });
  });

  it("campos ausentes quedan vacíos", () => {
    expect(leerCampos(new FormData())).toEqual({ nombre: "", email: "", telefono: "", pedido: "", motivo: "" });
  });
});

describe("validarCampos", () => {
  it("válido sin pedido ni motivo", () => {
    expect(validarCampos(campos())).toEqual({});
  });

  it("falta email / email inválido", () => {
    expect(validarCampos(campos({ email: "" }))).toEqual({ email: "Ingrese su email." });
    expect(validarCampos(campos({ email: "ana@" }))).toEqual({ email: "Ingrese un email válido." });
  });

  it("faltan nombre y teléfono", () => {
    expect(validarCampos(campos({ nombre: "", telefono: "" }))).toEqual({
      nombre: "Ingrese su nombre.",
      telefono: "Ingrese su teléfono.",
    });
  });

  it("topes de largo", () => {
    const errores = validarCampos(
      campos({
        nombre: "a".repeat(LARGOS.nombre + 1),
        telefono: "1".repeat(LARGOS.telefono + 1),
        pedido: "p".repeat(LARGOS.pedido + 1),
        motivo: "m".repeat(LARGOS.motivo + 1),
      }),
    );
    expect(errores).toEqual({
      nombre: "El nombre supera los 120 caracteres.",
      telefono: "El teléfono supera los 40 caracteres.",
      pedido: "El número de pedido supera los 40 caracteres.",
      motivo: "El motivo supera los 1000 caracteres.",
    });
    expect(validarCampos(campos({ email: `${"a".repeat(250)}@cliente.example` }))).toEqual({
      email: "El email supera los 254 caracteres.",
    });
  });
});

describe("llenadoValido", () => {
  const ahora = 1_800_000_000_000;
  it("menos de 3 s, más de 24 h o sin marca: no", () => {
    expect(llenadoValido(String(ahora - 1000), ahora)).toBe(false);
    expect(llenadoValido(String(ahora - 25 * 60 * 60_000), ahora)).toBe(false);
    expect(llenadoValido(null, ahora)).toBe(false);
    expect(llenadoValido("abc", ahora)).toBe(false);
    expect(llenadoValido(String(ahora + 10_000), ahora)).toBe(false);
  });
  it("5 s: sí", () => {
    expect(llenadoValido(String(ahora - 5000), ahora)).toBe(true);
  });
});

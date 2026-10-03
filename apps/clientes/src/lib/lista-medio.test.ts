import { describe, expect, it } from "vitest";
import type { MedioPago } from "./medios-pago";
import { idListaDelMedio, pagoParaCotizar } from "./lista-medio";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "transferencia",
  nombre: "Transferencia",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 1,
  idListaPrecios: "7",
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

describe("idListaDelMedio", () => {
  it("devuelve la lista del medio activo aplicable", () => {
    expect(idListaDelMedio([medio({})], "retiro", "transferencia")).toBe("7");
  });

  it("undefined si el medio no tiene lista", () => {
    expect(idListaDelMedio([medio({ idListaPrecios: null })], "retiro", "transferencia")).toBeUndefined();
  });

  it("undefined si el slug no existe", () => {
    expect(idListaDelMedio([medio({})], "retiro", "otro")).toBeUndefined();
  });

  it("undefined si el medio está inactivo", () => {
    expect(idListaDelMedio([medio({ activo: false })], "retiro", "transferencia")).toBeUndefined();
  });

  it("undefined si no aplica a la modalidad", () => {
    const m = medio({ aplicaEnvio: false });
    expect(idListaDelMedio([m], "envio", "transferencia")).toBeUndefined();
    expect(idListaDelMedio([m], "retiro", "transferencia")).toBe("7");
  });

  it("undefined para a_coordinar", () => {
    expect(idListaDelMedio([medio({ slug: "a_coordinar" })], "retiro", "a_coordinar")).toBeUndefined();
  });

  it("undefined con slug vacío o ausente (la lista sale solo del slug)", () => {
    expect(idListaDelMedio([medio({})], "retiro", "")).toBeUndefined();
    expect(idListaDelMedio([medio({})], "retiro", undefined)).toBeUndefined();
  });
});

describe("pagoParaCotizar", () => {
  const A = medio({ slug: "a", orden: 1, idListaPrecios: "9" });
  const B = medio({ slug: "b", orden: 2, idListaPrecios: "9" });
  const C = medio({ slug: "c", orden: 3, idListaPrecios: "5" });
  const D = medio({ slug: "d", orden: 4, idListaPrecios: null });
  const E = medio({ slug: "e", orden: 5, idListaPrecios: null });
  const todos = [A, B, C, D, E];

  it("la clave es la lista, no el slug: medios con la misma lista no refetchean", () => {
    expect(pagoParaCotizar(todos, "retiro", A)).toEqual(pagoParaCotizar(todos, "retiro", B));
    expect(pagoParaCotizar(todos, "retiro", B).pagoMetodo).toBe("a");
  });

  it("medios sin lista comparten clave vacía y no mandan slug", () => {
    expect(pagoParaCotizar(todos, "retiro", D)).toEqual({ listaKey: "", pagoMetodo: undefined });
    expect(pagoParaCotizar(todos, "retiro", E)).toEqual(pagoParaCotizar(todos, "retiro", D));
    expect(pagoParaCotizar(todos, "retiro", null)).toEqual({ listaKey: "", pagoMetodo: undefined });
  });

  it("listas distintas dan claves distintas", () => {
    expect(pagoParaCotizar(todos, "retiro", C).listaKey).toBe("5");
    expect(pagoParaCotizar(todos, "retiro", A).listaKey).not.toBe("5");
  });
});

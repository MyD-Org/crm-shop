import { describe, expect, it, vi } from "vitest";
import { resolverListaCuenta } from "./lista-cuenta";

/** Enlace sintético: la lista 7 de Alegra (cuenta principal) apunta a la lista privada "lista-privada-a". */
const buscar = vi.fn(async (cuenta: string, idLista: string) =>
  cuenta === "principal" && idLista === "7" ? "lista-privada-a" : null,
);

describe("resolverListaCuenta", () => {
  it("cuenta corriente con lista de Alegra enlazada: devuelve la lista privada", async () => {
    expect(await resolverListaCuenta({ tipoCuenta: "corriente", priceListId: "7" }, "principal", buscar)).toBe(
      "lista-privada-a",
    );
    expect(buscar).toHaveBeenCalledWith("principal", "7");
  });

  it("cuenta corriente sin lista en Alegra: precio público, sin consultar el enlace", async () => {
    buscar.mockClear();
    expect(await resolverListaCuenta({ tipoCuenta: "corriente", priceListId: null }, "principal", buscar)).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("cuenta corriente con lista sin enlace: precio público", async () => {
    expect(await resolverListaCuenta({ tipoCuenta: "corriente", priceListId: "99" }, "principal", buscar)).toBeNull();
  });

  it("contado, aunque tenga una lista enlazada: precio público y no consulta el enlace", async () => {
    buscar.mockClear();
    expect(await resolverListaCuenta({ tipoCuenta: "contado", priceListId: "7" }, "principal", buscar)).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("sin contacto (anónimo, sin vincular o sin fila en el espejo): precio público", async () => {
    buscar.mockClear();
    expect(await resolverListaCuenta(null, "principal", buscar)).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("la clave incluye la cuenta de Alegra: la misma lista en otra cuenta no matchea", async () => {
    expect(await resolverListaCuenta({ tipoCuenta: "corriente", priceListId: "7" }, "mdp", buscar)).toBeNull();
  });
});

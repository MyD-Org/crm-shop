import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ llamadas: [] as unknown[][], falla: false }));
vi.mock("next/cache", () => ({
  revalidateTag: (...a: unknown[]) => {
    estado.llamadas.push(a);
    if (estado.falla) throw new Error("sin store");
  },
}));

import { marcarStockCambiado } from "./cache-invalidar";

describe("marcarStockCambiado", () => {
  beforeEach(() => {
    estado.llamadas = [];
    estado.falla = false;
  });

  it("marca vencido el tag catalogo con stale-while-revalidate (max)", () => {
    marcarStockCambiado("crear un pedido");
    expect(estado.llamadas).toEqual([["catalogo", "max"]]);
  });

  it("nunca tira: el pedido ya está guardado", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    estado.falla = true;
    expect(() => marcarStockCambiado("cancelar un pedido")).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ llamadas: [] as unknown[][], falla: false }));
vi.mock("next/cache", () => ({
  revalidateTag: (...a: unknown[]) => {
    estado.llamadas.push(a);
    if (estado.falla) throw new Error("sin store");
  },
}));

import { marcarModalidadesCambiadas, marcarStockCambiado } from "./cache-invalidar";

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

describe("marcarModalidadesCambiadas", () => {
  beforeEach(() => {
    estado.llamadas = [];
    estado.falla = false;
  });

  it("vence el tag catalogo al instante (la lista cacheada de modalidades quedó vieja)", () => {
    marcarModalidadesCambiadas();
    expect(estado.llamadas).toEqual([["catalogo", { expire: 0 }]]);
  });

  it("nunca tira", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    estado.falla = true;
    expect(() => marcarModalidadesCambiadas()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

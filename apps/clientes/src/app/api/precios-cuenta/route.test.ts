import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

/**
 * `/api/precios-cuenta` queda detrás del flag `precio-especial-cuenta`: apagado responde
 * `{ especial: false }` (el navegador deja de preguntar y no hay badge, tachado ni "Precio
 * exclusivo"); prendido, comportamiento previo.
 */
const preciosCuentaPorIds = vi.fn();

vi.mock("@/lib/auth", async () => {
  // El corte real vive en `idPriceListCliente`: se reproduce con el módulo del flag verdadero.
  const { precioEspecialCuenta } = await import("@/lib/precio-especial-flag");
  return {
    identidadActual: async () => ({ clerkUserId: "user_1", cliente: { codigocliente: "42" } }),
    idPriceListCliente: async () => ((await precioEspecialCuenta()) ? "7" : undefined),
  };
});
vi.mock("@/lib/catalog", () => ({ preciosCuentaPorIds: (...a: unknown[]) => preciosCuentaPorIds(...a) }));

import { GET } from "./route";

const pedir = () => GET(new Request("https://tienda.example/api/precios-cuenta?ids=1,2"));

beforeEach(() => {
  preciosCuentaPorIds.mockReset();
  preciosCuentaPorIds.mockResolvedValue({ "1": { price: 800 } });
});

describe("GET /api/precios-cuenta", () => {
  it("con el flag apagado responde especial:false y no consulta precios", async () => {
    const r = await pedir();
    expect(await r.json()).toEqual({ especial: false, precios: {} });
    expect(preciosCuentaPorIds).not.toHaveBeenCalled();
  });

  it("con el flag prendido devuelve los precios de la lista propia", async () => {
    setFlag("precio-especial-cuenta", true);
    const r = await pedir();
    expect(await r.json()).toEqual({ especial: true, precios: { "1": { price: 800 } } });
    expect(preciosCuentaPorIds).toHaveBeenCalledWith(["1", "2"], "7");
  });
});

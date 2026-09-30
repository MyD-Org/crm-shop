import { describe, expect, it, vi } from "vitest";
import { JEV_GLOBAL_POR_MINUTO, JEV_POR_IP_POR_MINUTO, jevConTope } from "./limite";

const respuesta = { raiz: { choice: "x", confidence: 1 } };

describe("jevConTope", () => {
  it("dentro del tope llama a Jev; decide una vez por interpretación (las dos llamadas)", async () => {
    const jev = vi.fn(async () => respuesta);
    const puede = vi.fn(() => true);
    const limitado = jevConTope(jev, "1.2.3.4", puede);
    expect(await limitado("q", {}, 2500)).toBe(respuesta);
    await limitado("q", {}, 1000);
    expect(jev).toHaveBeenCalledTimes(2);
    expect(puede).toHaveBeenCalledTimes(2); // IP + global, una sola vez
    expect(puede).toHaveBeenCalledWith("busqueda-ia-jev:1.2.3.4", JEV_POR_IP_POR_MINUTO, 60_000);
    expect(puede).toHaveBeenCalledWith("busqueda-ia-jev:global", JEV_GLOBAL_POR_MINUTO, 60_000);
  });

  it("pasado el tope por IP no llama a Jev ni gasta cupo global: devuelve null (queda lo determinista)", async () => {
    const jev = vi.fn(async () => respuesta);
    const puede = vi.fn((clave: string) => !clave.endsWith("1.2.3.4"));
    expect(await jevConTope(jev, "1.2.3.4", puede)("q", {}, 2500)).toBeNull();
    expect(jev).not.toHaveBeenCalled();
    expect(puede).toHaveBeenCalledTimes(1);
  });

  it("pasado el techo global, tampoco", async () => {
    const jev = vi.fn(async () => respuesta);
    expect(await jevConTope(jev, "5.6.7.8", (c) => c !== "busqueda-ia-jev:global")("q", {}, 2500)).toBeNull();
    expect(jev).not.toHaveBeenCalled();
  });
});

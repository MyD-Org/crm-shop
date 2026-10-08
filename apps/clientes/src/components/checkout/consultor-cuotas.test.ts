import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { binValido, crearConsultorCuotas, DEMORA_BIN_MS } from "./consultor-cuotas";

const datos = (n: number) => ({ opciones: [{ clave: `x-${n}` }] }) as never;

describe("binValido", () => {
  it("sólo 6 a 8 dígitos; lo demás es 'sin tarjeta'", () => {
    expect(binValido("450712")).toBe("450712");
    expect(binValido("45071234")).toBe("45071234");
    expect(binValido("")).toBeNull();
    expect(binValido("4507")).toBeNull();
    expect(binValido("45071234999")).toBeNull();
    expect(binValido(undefined)).toBeNull();
  });
});

describe("crearConsultorCuotas", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("al montar pide enseguida (sin tarjeta: planes de referencia)", async () => {
    const consultar = vi.fn().mockResolvedValue(datos(1));
    const alResultado = vi.fn();
    const c = crearConsultorCuotas({ consultar, alResultado });
    c.pedir(null, { inmediato: true });
    await vi.runAllTimersAsync();
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(consultar.mock.calls[0][0]).toBeNull();
    expect(alResultado).toHaveBeenCalledWith({ datos: datos(1), error: false });
  });

  it(`cada cambio de BIN espera ${DEMORA_BIN_MS} ms y sólo consulta el último`, async () => {
    const consultar = vi.fn().mockResolvedValue(datos(2));
    const c = crearConsultorCuotas({ consultar, alResultado: vi.fn() });
    c.pedir("450712");
    await vi.advanceTimersByTimeAsync(100);
    c.pedir("45071234");
    await vi.advanceTimersByTimeAsync(DEMORA_BIN_MS - 1);
    expect(consultar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(consultar.mock.calls[0][0]).toBe("45071234");
  });

  it("una consulta nueva aborta la anterior y su respuesta se ignora", async () => {
    let resolverPrimera: (v: unknown) => void = () => {};
    const consultar = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (resolverPrimera = r)))
      .mockResolvedValueOnce(datos(2));
    const alResultado = vi.fn();
    const c = crearConsultorCuotas({ consultar, alResultado });
    c.pedir(null, { inmediato: true });
    await vi.advanceTimersByTimeAsync(0);
    const primeraSenal = consultar.mock.calls[0][1] as AbortSignal;
    c.pedir("450712", { inmediato: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(primeraSenal.aborted).toBe(true);
    resolverPrimera(datos(1));
    await vi.runAllTimersAsync();
    expect(alResultado).toHaveBeenCalledTimes(1);
    expect(alResultado).toHaveBeenCalledWith({ datos: datos(2), error: false });
  });

  it("si falla (red o respuesta no OK) avisa error: el formulario cae a lo del pedido", async () => {
    const alResultado = vi.fn();
    const c = crearConsultorCuotas({ consultar: vi.fn().mockRejectedValue(new TypeError("x")), alResultado });
    c.pedir(null, { inmediato: true });
    await vi.runAllTimersAsync();
    expect(alResultado).toHaveBeenCalledWith({ datos: null, error: true });

    const alResultado2 = vi.fn();
    const c2 = crearConsultorCuotas({ consultar: vi.fn().mockResolvedValue(null), alResultado: alResultado2 });
    c2.pedir(null, { inmediato: true });
    await vi.runAllTimersAsync();
    expect(alResultado2).toHaveBeenCalledWith({ datos: null, error: true });
  });

  it("cerrar() cancela lo pendiente y lo que está en vuelo", async () => {
    const consultar = vi.fn().mockResolvedValue(datos(1));
    const alResultado = vi.fn();
    const c = crearConsultorCuotas({ consultar, alResultado });
    c.pedir("450712");
    c.cerrar();
    await vi.runAllTimersAsync();
    expect(consultar).not.toHaveBeenCalled();
    expect(alResultado).not.toHaveBeenCalled();
  });
});

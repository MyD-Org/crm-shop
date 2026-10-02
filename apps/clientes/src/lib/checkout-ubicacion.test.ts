import { describe, expect, it, vi } from "vitest";
import type { DireccionEnvio } from "./direcciones-envio";
import { OTRA_DIRECCION } from "./direcciones-envio";
import {
  cuerpoDeSincronizacion,
  estadoInicialCheckout,
  sincronizarUbicacion,
} from "./checkout-ubicacion";

const dir = (id: string, predeterminada = false): DireccionEnvio => ({
  id,
  etiqueta: null,
  calle: "Calle Ejemplo 123",
  ciudad: "Ciudad Ejemplo",
  provincia: "Córdoba",
  cp: "5000",
  referencias: null,
  predeterminada,
});

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const base = {
  direcciones: [dir(D1, true), dir(D2)],
  envioOfrecido: true,
  locales: ["a", "b"],
  localInicial: "a" as string | null,
  provinciaInicial: null as string | null,
};

describe("estadoInicialCheckout", () => {
  it("retiro elegido en el local B: arranca en retiro con ese local", () => {
    const e = estadoInicialCheckout({ ...base, eleccion: { tipo: "retiro", sucursal: "b" } });
    expect(e.opcionEntrega).toBe("retiro");
    expect(e.localRetiro).toBe("b");
  });

  it("envío con una dirección no predeterminada: la preselecciona", () => {
    const e = estadoInicialCheckout({ ...base, eleccion: { tipo: "envio", direccionId: D2, provincia: "cordoba" } });
    expect(e.opcionEntrega).toBe("domicilio");
    expect(e.eleccionDireccion).toBe(D2);
    expect(e.provinciaManual).toBe("cordoba");
  });

  it("sin elección: el comportamiento de siempre (retiro, predeterminada, local inicial)", () => {
    for (const eleccion of [null, undefined, { tipo: "ninguna" as const }]) {
      const e = estadoInicialCheckout({ ...base, eleccion });
      expect(e).toEqual({ opcionEntrega: "retiro", localRetiro: "a", eleccionDireccion: D1, provinciaManual: "" });
    }
  });

  it("elección vencida: dirección borrada o local inexistente caen al valor de siempre, sin error", () => {
    const envio = estadoInicialCheckout({ ...base, eleccion: { tipo: "envio", direccionId: "zzz" } });
    expect(envio.eleccionDireccion).toBe(D1);
    const retiro = estadoInicialCheckout({ ...base, eleccion: { tipo: "retiro", sucursal: "borrado" } });
    expect(retiro.localRetiro).toBe("a");
  });

  it("envío elegido pero el envío no se ofrece: retiro", () => {
    const e = estadoInicialCheckout({ ...base, envioOfrecido: false, eleccion: { tipo: "envio", direccionId: D2 } });
    expect(e.opcionEntrega).toBe("retiro");
  });

  it("sin direcciones guardadas: 'otra dirección'", () => {
    const e = estadoInicialCheckout({ ...base, direcciones: [], eleccion: { tipo: "envio" } });
    expect(e.eleccionDireccion).toBe(OTRA_DIRECCION);
  });

  it("flag sucursales apagado (sin locales): local vacío y retiro sin slug", () => {
    const e = estadoInicialCheckout({ ...base, locales: [], localInicial: null, eleccion: { tipo: "retiro" } });
    expect(e.opcionEntrega).toBe("retiro");
    expect(e.localRetiro).toBe("");
  });

  it("la provincia de la zona se conserva si la elección no trae una", () => {
    const e = estadoInicialCheckout({ ...base, provinciaInicial: "salta", eleccion: null });
    expect(e.provinciaManual).toBe("salta");
  });
});

describe("cuerpoDeSincronizacion", () => {
  const c = {
    direcciones: base.direcciones,
    conSucursales: true,
    usarFiscal: false,
  };
  it("retiro con local B: {tipo, sucursal}", () => {
    expect(cuerpoDeSincronizacion({ ...c, opcionEntrega: "retiro", localRetiro: "b", eleccionDireccion: D1 })).toEqual({
      tipo: "retiro",
      sucursal: "b",
    });
  });
  it("retiro sin sucursales (flag apagado): {tipo} sin sucursal", () => {
    expect(
      cuerpoDeSincronizacion({ ...c, conSucursales: false, opcionEntrega: "retiro", localRetiro: "", eleccionDireccion: D1 }),
    ).toEqual({ tipo: "retiro" });
  });
  it("domicilio con dirección guardada: {direccionId}", () => {
    expect(cuerpoDeSincronizacion({ ...c, opcionEntrega: "domicilio", localRetiro: "a", eleccionDireccion: D2 })).toEqual({
      direccionId: D2,
    });
  });
  it("'Otra dirección' y domicilio fiscal no sincronizan", () => {
    expect(
      cuerpoDeSincronizacion({ ...c, opcionEntrega: "domicilio", localRetiro: "a", eleccionDireccion: OTRA_DIRECCION }),
    ).toBeNull();
    expect(
      cuerpoDeSincronizacion({ ...c, usarFiscal: true, opcionEntrega: "domicilio", localRetiro: "a", eleccionDireccion: D1 }),
    ).toBeNull();
  });
});

describe("sincronizarUbicacion", () => {
  it("hace POST /api/ubicacion con keepalive", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    await sincronizarUbicacion(f as unknown as typeof fetch, { tipo: "retiro", sucursal: "b" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/ubicacion");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ tipo: "retiro", sucursal: "b" });
  });
  it("ignora un fallo de red y un 4xx: nunca lanza", async () => {
    const rota = vi.fn().mockRejectedValue(new Error("red"));
    await expect(sincronizarUbicacion(rota as unknown as typeof fetch, { direccionId: D1 })).resolves.toBeUndefined();
    const mala = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(sincronizarUbicacion(mala as unknown as typeof fetch, { direccionId: D1 })).resolves.toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("./medios-pago-repo", () => ({ leerMediosPago: vi.fn() }));

import { leerMediosPago } from "./medios-pago-repo";
import { mediosOfrecibles, sinMpSiNoConfigurado } from "./medios-pago-datos";
import type { MedioPago } from "./medios-pago";

const medio = (slug: string): MedioPago => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: slug === "mercadopago",
  orden: 0,
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
});

afterEach(() => vi.unstubAllEnvs());

describe("mediosOfrecibles", () => {
  it("con credenciales ofrece todos, incluido mercadopago", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-token");
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-key");
    vi.mocked(leerMediosPago).mockResolvedValue([medio("transferencia"), medio("mercadopago")]);
    expect((await mediosOfrecibles()).map((m) => m.slug)).toEqual(["transferencia", "mercadopago"]);
  });
  it("sin credenciales saca mercadopago y deja el resto", async () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "");
    vi.mocked(leerMediosPago).mockResolvedValue([medio("transferencia"), medio("mercadopago")]);
    expect((await mediosOfrecibles()).map((m) => m.slug)).toEqual(["transferencia"]);
  });
  it("sinMpSiNoConfigurado no muta la lista de entrada", () => {
    vi.stubEnv("MP_ACCESS_TOKEN", "");
    const entrada = [medio("mercadopago")];
    expect(sinMpSiNoConfigurado(entrada)).toEqual([]);
    expect(entrada).toHaveLength(1);
  });
});

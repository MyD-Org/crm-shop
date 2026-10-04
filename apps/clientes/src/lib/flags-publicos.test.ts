import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { MedioPago } from "./medios-pago";

const { mediosOfrecibles, mediosOfreciblesSinCache } = vi.hoisted(() => ({
  mediosOfrecibles: vi.fn(),
  mediosOfreciblesSinCache: vi.fn(),
}));
vi.mock("./medios-pago-datos", () => ({ mediosOfrecibles, mediosOfreciblesSinCache }));

import { flagsPublicos } from "./flags-publicos";

const medio = (slug: string, extra: Partial<MedioPago> = {}): MedioPago => ({
  slug,
  nombre: slug.toUpperCase(),
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  idListaPrecios: "L1",
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...extra,
});

describe("flagsPublicos", () => {
  beforeEach(() => {
    mediosOfrecibles.mockReset();
    mediosOfrecibles.mockResolvedValue([]);
    mediosOfreciblesSinCache.mockReset();
    mediosOfreciblesSinCache.mockResolvedValue([]);
  });

  it("apagados por defecto (igual que el defaultValue de Vercel Flags)", async () => {
    expect(await flagsPublicos()).toEqual({
      soloVisibles: false,
      cuotas: false,
      mediosPrecio: { destacado: null, ficha: [] },
    });
  });

  it("refleja catalogo-solo-visibles y cuotas", async () => {
    setFlag("catalogo-solo-visibles", true);
    setFlag("cuotas", true);
    const f = await flagsPublicos();
    expect(f.soloVisibles).toBe(true);
    expect(f.cuotas).toBe(true);
  });

  it("mediosPrecio: el destacado y los de la ficha salen de los medios del CRM", async () => {
    mediosOfrecibles.mockResolvedValue([
      medio("aa", { destacarEnCatalogo: true }),
      medio("bb", { mostrarEnFicha: true, orden: 2 }),
      medio("cc", { mostrarEnFicha: true, orden: 1 }),
    ]);
    const { mediosPrecio } = await flagsPublicos();
    expect(mediosPrecio.destacado?.slug).toBe("aa");
    expect(mediosPrecio.ficha.map((m) => m.slug)).toEqual(["cc", "bb"]);
  });

  it("con precio-especial-cuenta encendido: sin líneas 'con X'", async () => {
    mediosOfrecibles.mockResolvedValue([medio("aa", { destacarEnCatalogo: true, mostrarEnFicha: true })]);
    setFlag("precio-especial-cuenta", true);
    expect((await flagsPublicos()).mediosPrecio).toEqual({ destacado: null, ficha: [] });
  });

  it("si falla la lectura cacheada, relee los medios sin caché", async () => {
    mediosOfrecibles.mockRejectedValue(new Error("Connection closed."));
    mediosOfreciblesSinCache.mockResolvedValue([medio("aa", { destacarEnCatalogo: true })]);
    expect((await flagsPublicos()).mediosPrecio.destacado?.slug).toBe("aa");
  });

  it("medios ilegibles: degrada a vacío sin romper", async () => {
    mediosOfrecibles.mockRejectedValue(new Error("base caída"));
    mediosOfreciblesSinCache.mockRejectedValue(new Error("base caída"));
    expect((await flagsPublicos()).mediosPrecio).toEqual({ destacado: null, ficha: [] });
  });
});

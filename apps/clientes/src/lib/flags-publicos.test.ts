import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { MedioPago } from "./medios-pago";

const { mediosOfrecibles, cuotasSinInteresMP } = vi.hoisted(() => ({
  mediosOfrecibles: vi.fn(),
  cuotasSinInteresMP: vi.fn(),
}));
vi.mock("./medios-pago-datos", () => ({ mediosOfrecibles }));
vi.mock("./pagos/cuotas-sin-interes-mp", () => ({ cuotasSinInteresMP }));

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
    cuotasSinInteresMP.mockReset();
    cuotasSinInteresMP.mockResolvedValue(null);
  });

  it("apagados por defecto (igual que el defaultValue de Vercel Flags)", async () => {
    expect(await flagsPublicos()).toEqual({
      soloVisibles: false,
      cuotas: false,
      variantes: false,
      envioZona: false,
      mediosPrecio: { destacado: null, ficha: [] },
    });
  });

  it("refleja catalogo-solo-visibles y cuotas", async () => {
    setFlag("catalogo-solo-visibles", true);
    setFlag("cuotas-cobro", true);
    const f = await flagsPublicos();
    expect(f.soloVisibles).toBe(true);
    expect(f.cuotas).toBe(true);
  });

  it("refleja variantes-selector (apagado por defecto)", async () => {
    expect((await flagsPublicos()).variantes).toBe(false);
    setFlag("variantes-selector", true);
    expect((await flagsPublicos()).variantes).toBe(true);
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

  it("mediosPrecio.cuotas: sólo con el flag cuotas-cobro y un medio de cobro en línea con condiciones", async () => {
    const mp = medio("mercadopago", {
      cobroOnline: true,
      idListaPrecios: null,
      condicionesCuotas: [{ cuotas: 6, idListaPrecios: "L6" }],
    });
    mediosOfrecibles.mockResolvedValue([mp]);
    expect((await flagsPublicos()).mediosPrecio.cuotas).toBeUndefined();
    setFlag("cuotas-cobro", true);
    // La lectura se deduplica por request (`cache` de React): se reimporta para un request nuevo.
    vi.resetModules();
    const { flagsPublicos: nuevo } = await import("./flags-publicos");
    expect((await nuevo()).mediosPrecio.cuotas).toEqual([
      {
        slug: "mercadopago",
        nombre: "MERCADOPAGO",
        idListaPagoUnico: null,
        condiciones: [{ cuotas: 6, idListaPrecios: "L6" }],
      },
    ]);
  });

  it("mediosPrecio.cuotas: Mercado Pago sin condiciones toma las cuotas sin interés de su cuenta", async () => {
    mediosOfrecibles.mockResolvedValue([medio("mercadopago", { cobroOnline: true, idListaPrecios: "LU" })]);
    cuotasSinInteresMP.mockResolvedValue(3);
    expect((await flagsPublicos()).mediosPrecio.cuotas).toBeUndefined();
    expect(cuotasSinInteresMP).not.toHaveBeenCalled();
    setFlag("cuotas-cobro", true);
    vi.resetModules();
    const { flagsPublicos: nuevo } = await import("./flags-publicos");
    expect((await nuevo()).mediosPrecio.cuotas).toEqual([
      { slug: "mercadopago", nombre: "MERCADOPAGO", idListaPagoUnico: "LU", condiciones: [{ cuotas: 3, idListaPrecios: "LU" }] },
    ]);
  });

  it("si la lectura de MP falla, los medios siguen sin cuotas de MP", async () => {
    mediosOfrecibles.mockResolvedValue([medio("mercadopago", { cobroOnline: true, destacarEnCatalogo: true })]);
    cuotasSinInteresMP.mockRejectedValue(new Error("MP caído"));
    setFlag("cuotas-cobro", true);
    vi.resetModules();
    const { flagsPublicos: nuevo } = await import("./flags-publicos");
    const { mediosPrecio } = await nuevo();
    expect(mediosPrecio.cuotas).toBeUndefined();
    expect(mediosPrecio.destacado?.slug).toBe("mercadopago");
  });

  it("medios ilegibles: degrada a vacío sin romper", async () => {
    mediosOfrecibles.mockRejectedValue(new Error("base caída"));
    expect((await flagsPublicos()).mediosPrecio).toEqual({ destacado: null, ficha: [] });
  });
});

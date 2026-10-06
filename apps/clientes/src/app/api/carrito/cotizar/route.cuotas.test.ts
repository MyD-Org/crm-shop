import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { MedioPago } from "@/lib/medios-pago";

/**
 * Cuotas sin interés en la cotización (rebanada D). La cantidad de cuotas sale del body pero SÓLO
 * se acepta si el medio tiene una condición para ella; la lista de precios sale de esa condición,
 * nunca del body. Con el flag `cuotas-cobro` apagado no hay cuotas.
 */
let medios: MedioPago[];
const cotizar = vi.fn();

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: null, cliente: null }),
  idPriceListCliente: async () => "7",
}));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => (await import("@/lib/envio")).CONFIG_ENVIO_DEFAULT,
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));

import { POST } from "./route";

const mp = (o: Partial<MedioPago> = {}): MedioPago => ({
  slug: "mercadopago",
  nombre: "Mercado Pago",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: true,
  orden: 1,
  idListaPrecios: "L1",
  condicionesCuotas: [
    { cuotas: 3, idListaPrecios: "L3" },
    { cuotas: 6, idListaPrecios: "L6" },
  ],
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

let n = 0;
const pedir = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${(n = (n % 200) + 1)}` },
      body: JSON.stringify({ items: [{ id: "1", qty: 1 }], pagoMetodo: "mercadopago", ...extra }),
    }),
  );

const listaUsada = (i = 0) => (cotizar.mock.calls[i][1] as { idListaMedio?: string }).idListaMedio;

/** Total por lista: L1 (un pago) 1.210; L3 1.089; L6 1.161,60. */
const TOTALES: Record<string, number> = { L1: 1210, L3: 1089, L6: 1161.6 };

beforeEach(() => {
  medios = [mp()];
  cotizar.mockReset();
  cotizar.mockImplementation(async (_l: unknown, o: { idListaMedio?: string }) => ({
    lineas: [],
    subtotal: 0,
    iva: 0,
    costoEnvio: 0,
    total: TOTALES[o.idListaMedio ?? "L1"] ?? 1210,
    hayProblemas: false,
  }));
  setFlag("cuotas-cobro", true);
});

describe("POST /api/carrito/cotizar con cuotas", () => {
  it("N cuotas cotiza con la lista de la condición", async () => {
    const r = await pedir({ cuotas: 6 });
    expect(r.status).toBe(200);
    expect(listaUsada()).toBe("L6");
    expect((await r.json()).total).toBe(1161.6);
  });

  it("un pago (o sin cuotas) cotiza con la lista del pago único", async () => {
    await pedir({ cuotas: 1 });
    expect(listaUsada()).toBe("L1");
    await pedir();
    expect(listaUsada(1)).toBe("L1");
  });

  it("una cantidad sin condición se rechaza (422, en usted) y no cotiza", async () => {
    const r = await pedir({ cuotas: 12 });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe("La cantidad de cuotas elegida ya no está disponible. Seleccione otra.");
    expect(cotizar).not.toHaveBeenCalled();
  });

  it("cuotas inválidas (string, decimal, 0) se rechazan", async () => {
    for (const cuotas of ["6", 3.5, 0, -2]) {
      expect((await pedir({ cuotas })).status).toBe(422);
    }
  });

  it("flag apagado: las cuotas se ignoran y no hay opciones", async () => {
    setFlag("cuotas-cobro", false);
    const r = await pedir({ cuotas: 6, conCuotas: true });
    expect(r.status).toBe(200);
    expect(listaUsada()).toBe("L1");
    expect((await r.json()).cuotasOpciones).toBeUndefined();
  });

  it("un medio sin cobro en línea no tiene cuotas (se ignoran)", async () => {
    medios = [mp({ cobroOnline: false })];
    const r = await pedir({ cuotas: 6, conCuotas: true });
    expect(r.status).toBe(200);
    expect(listaUsada()).toBe("L1");
    expect((await r.json()).cuotasOpciones).toBeUndefined();
  });

  it("el body no puede traer la lista", async () => {
    await pedir({ cuotas: 6, idListaMedio: "L-otra", idPriceList: "99" });
    expect(listaUsada()).toBe("L6");
  });

  it("con conCuotas devuelve el total y la cuota de cada cantidad (un pago incluido), de la lista de cada una", async () => {
    const r = await pedir({ conCuotas: true });
    expect((await r.json()).cuotasOpciones).toEqual([
      { cuotas: 1, total: 1210, montoCuota: 1210, primeraCuota: 1210 },
      { cuotas: 3, total: 1089, montoCuota: 363, primeraCuota: 363 },
      { cuotas: 6, total: 1161.6, montoCuota: 193.6, primeraCuota: 193.6 },
    ]);
  });

  it("con precio-especial-cuenta prendido no hay cuotas", async () => {
    setFlag("precio-especial-cuenta", true);
    const r = await pedir({ cuotas: 6, conCuotas: true });
    expect(r.status).toBe(200);
    expect((await r.json()).cuotasOpciones).toBeUndefined();
  });
});

describe("POST /api/carrito/cotizar con monto mínimo por cuotas", () => {
  const conMinimo = (minimo: number | null) =>
    mp({
      condicionesCuotas: [
        { cuotas: 3, idListaPrecios: "L3", montoMinimo: null },
        { cuotas: 6, idListaPrecios: "L6", montoMinimo: minimo },
      ],
    });
  const cuotasDe = async (r: Response) =>
    ((await r.json()).cuotasOpciones as { cuotas: number }[]).map((o) => o.cuotas);

  it("las opciones sólo incluyen las cantidades cuyo mínimo alcanza el total del pago único", async () => {
    medios = [conMinimo(1210.01)];
    expect(await cuotasDe(await pedir({ conCuotas: true }))).toEqual([1, 3]);
  });

  it("justo en el mínimo la cantidad se ofrece", async () => {
    medios = [conMinimo(1210)];
    expect(await cuotasDe(await pedir({ conCuotas: true }))).toEqual([1, 3, 6]);
  });

  it("elegir una cantidad bajo el mínimo se rechaza (422) y la base se cotiza con la lista del pago único", async () => {
    medios = [conMinimo(5000)];
    const r = await pedir({ cuotas: 6 });
    expect(r.status).toBe(422);
    expect((await r.json()).motivo).toBe("cuotas_no_disponibles");
    expect(listaUsada()).toBe("L1");
  });

  it("elegir una cantidad que alcanza el mínimo cotiza con su lista", async () => {
    medios = [conMinimo(1000)];
    const r = await pedir({ cuotas: 6 });
    expect(r.status).toBe(200);
    expect(cotizar.mock.calls.map((c) => (c[1] as { idListaMedio?: string }).idListaMedio)).toEqual(["L1", "L6"]);
    expect((await r.json()).total).toBe(1161.6);
  });

  it("sin mínimos no se agrega ninguna cotización (comportamiento de siempre)", async () => {
    medios = [conMinimo(null)];
    await pedir({ cuotas: 6 });
    expect(cotizar).toHaveBeenCalledTimes(1);
  });
});

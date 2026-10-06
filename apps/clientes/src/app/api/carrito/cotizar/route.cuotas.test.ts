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

let cliente: { codigocliente: string } | null = null;
let listaPrivada: string | null = null;
vi.mock("@/lib/auth", () => ({ identidadActual: async () => ({ clerkUserId: null, cliente }) }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => listaPrivada }));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => (await import("@/lib/envio")).CONFIG_ENVIO_DEFAULT,
}));
let procesadoresOk = true;
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => procesadoresOk }));
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
  cliente = null;
  listaPrivada = null;
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
      { cuotas: 1, total: 1210, montoCuota: 1210 },
      { cuotas: 3, total: 1089, montoCuota: 363 },
      { cuotas: 6, total: 1161.6, montoCuota: 193.6 },
    ]);
  });

  it("con lista privada no hay cuotas", async () => {
    cliente = { codigocliente: "42" };
    listaPrivada = "lista-privada-a";
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

describe("POST /api/carrito/cotizar: próximo escalón de cuotas", () => {
  const conMinimo = (minimo: number) =>
    mp({
      condicionesCuotas: [
        { cuotas: 3, idListaPrecios: "L3", montoMinimo: null },
        { cuotas: 6, idListaPrecios: "L6", montoMinimo: minimo },
      ],
    });

  it("con conCuotas informa cuántas cuotas se habilitan y cuánto falta", async () => {
    medios = [conMinimo(2000)];
    const j = await (await pedir({ conCuotas: true })).json();
    expect(j.proximoEscalon).toEqual({ cuotas: 6, falta: 790 });
  });

  it("si ya alcanza todos los mínimos, no hay próximo escalón", async () => {
    medios = [conMinimo(1000)];
    expect((await (await pedir({ conCuotas: true })).json()).proximoEscalon).toBeUndefined();
  });
});

describe("POST /api/carrito/cotizar: progreso de cuotas (barra del carrito)", () => {
  const conMinimo = (minimo: number, o: Partial<MedioPago> = {}) =>
    mp({
      condicionesCuotas: [
        { cuotas: 3, idListaPrecios: "L3", montoMinimo: null },
        { cuotas: 6, idListaPrecios: "L6", montoMinimo: minimo },
      ],
      ...o,
    });
  // Sin pagoMetodo: el carrito todavía no eligió medio.
  const carrito = (extra: Record<string, unknown> = {}) => pedir({ pagoMetodo: undefined, progresoCuotas: true, ...extra });

  it("sin medio elegido, el progreso combinado entre los medios de cobro en línea", async () => {
    medios = [conMinimo(2420)];
    const j = await (await carrito()).json();
    expect(j.progresoCuotas).toEqual({ cuotasActuales: 3, proximo: { cuotas: 6, falta: 1210, minimo: 2420 }, pct: 50 });
  });

  it("en el escalón más alto, lleno", async () => {
    medios = [conMinimo(1000)];
    const j = await (await carrito()).json();
    expect(j.progresoCuotas).toEqual({ cuotasActuales: 6, proximo: null, pct: 100 });
  });

  it("sin mínimos o sin pedirlo, no hay progreso", async () => {
    medios = [mp()];
    expect((await (await carrito()).json()).progresoCuotas).toBeUndefined();
    medios = [conMinimo(2420)];
    expect((await (await pedir({ pagoMetodo: undefined })).json()).progresoCuotas).toBeUndefined();
  });

  it("cuenta corriente o lista privada: sin barra", async () => {
    medios = [conMinimo(2420)];
    listaPrivada = "LP";
    cliente = { codigocliente: "C1" };
    expect((await (await carrito()).json()).progresoCuotas).toBeUndefined();
    listaPrivada = null;
    cliente = null;
  });

  it("un medio con mínimos pero sin credenciales del procesador no cuenta", async () => {
    medios = [conMinimo(2420)];
    procesadoresOk = false;
    try {
      expect((await (await carrito()).json()).progresoCuotas).toBeUndefined();
    } finally {
      procesadoresOk = true;
    }
  });

  it("un medio inactivo no cuenta", async () => {
    medios = [conMinimo(2420, { activo: false })];
    expect((await (await carrito()).json()).progresoCuotas).toBeUndefined();
  });

  it("el checkout (medio elegido) también informa el progreso de su medio", async () => {
    medios = [conMinimo(2420)];
    const j = await (await pedir({ conCuotas: true })).json();
    expect(j.progresoCuotas.proximo).toEqual({ cuotas: 6, falta: 1210, minimo: 2420 });
  });

  describe("la base nunca es 0 con un carrito con precio", () => {
    const linea = (o: Record<string, unknown> = {}) => ({
      id: "1", qty: 1, precioUnitario: 1000, ivaPorcentaje: 21, subtotal: 1000, iva: 210, total: 1210, stockDisponible: 5, ...o,
    });
    const respuesta = (lineas: ReturnType<typeof linea>[], total: number, problema = false) => ({
      lineas, subtotal: 0, iva: 0, costoEnvio: 0, total, hayProblemas: problema,
    });

    it("el medio sin lista de pago único (idListaPrecios null): base con la lista de referencia", async () => {
      medios = [conMinimo(2420, { idListaPrecios: null })];
      const j = await (await carrito()).json();
      expect(listaUsada()).toBeUndefined();
      expect(j.progresoCuotas).toEqual({ cuotasActuales: 3, proximo: { cuotas: 6, falta: 1210, minimo: 2420 }, pct: 50 });
    });

    it("la lista del pago único no tiene precio de un producto: cae a la referencia y no promete con base 0", async () => {
      medios = [conMinimo(2420)];
      cotizar.mockImplementation(async (_l: unknown, o: { idListaMedio?: string }) =>
        o.idListaMedio === "L1"
          ? respuesta([linea({ problema: "sin_precio", total: 0 })], 0, true)
          : respuesta([linea()], 1210),
      );
      const j = await (await carrito()).json();
      expect(j.progresoCuotas.proximo).toEqual({ cuotas: 6, falta: 1210, minimo: 2420 });
    });

    it("un producto con stock insuficiente no anula la base", async () => {
      medios = [conMinimo(2420)];
      cotizar.mockImplementation(async () =>
        respuesta([linea({ problema: "stock_insuficiente" }), linea({ id: "2", problema: "sin_stock" })], 0, true),
      );
      const j = await (await carrito()).json();
      expect(j.progresoCuotas).toEqual({ cuotasActuales: 6, proximo: null, pct: 100 });
    });

    it("sin precio ni en la referencia: sin barra (nunca se promete con base 0)", async () => {
      medios = [conMinimo(2420)];
      cotizar.mockImplementation(async () => respuesta([linea({ problema: "sin_precio", total: 0 })], 0, true));
      const r = await carrito();
      expect(r.status).toBe(200);
      expect((await r.json()).progresoCuotas).toBeUndefined();
    });

    it("si la cotización de la base falla: sin barra, la cotización principal sigue", async () => {
      medios = [conMinimo(2420)];
      let llamadas = 0;
      cotizar.mockImplementation(async () => {
        // La primera es la principal (sin medio); las siguientes, las de la base.
        if (llamadas++ > 0) throw new Error("base caída");
        return respuesta([linea()], 1210);
      });
      const r = await carrito();
      expect(r.status).toBe(200);
      expect((await r.json()).progresoCuotas).toBeUndefined();
    });

    it("checkout: base sin precio ni en la referencia no informa progreso ni próximo escalón", async () => {
      medios = [conMinimo(2420)];
      cotizar.mockImplementation(async () => respuesta([linea({ problema: "sin_precio", total: 0 })], 0, true));
      const j = await (await pedir({ conCuotas: true })).json();
      expect(j.progresoCuotas).toBeUndefined();
      expect(j.proximoEscalon).toBeUndefined();
    });
  });
});

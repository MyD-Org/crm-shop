import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { MedioPago } from "@/lib/medios-pago";
import type { DatosSucursales, SucursalVista } from "@/lib/sucursales-repo";

/**
 * Venta sin stock por modalidad en la cotización del carrito:
 * - Con el flag `disponibilidad-sucursal`, la ruta calcula PRIMERO la disponibilidad y le pasa a
 *   `cotizar` los ids que el motor dejó "por pedido" para la entrega elegida (`aPedido`).
 * - Un carrito con flujo `a_confirmar` (sin cuenta corriente ni lista privada) se recotiza con la
 *   lista que muestran las cards (la del medio destacado) y no trae nada de cobro en línea.
 */
let medios: MedioPago[];
const cotizar = vi.fn();
const disponibilidadParaMostrar = vi.fn();
let flujo: "normal" | "a_confirmar" = "normal";
let estadoDisp = false;
let cliente: { codigocliente: string; tipoCuenta?: string } | null = null;
let listaPrivada: string | null = null;
const disp = { zona: "sede-a", activas: ["sede-a", "sede-b"], contarEn: ["sede-a"], stockHeredado: "sede-a" };

const suc = (slug: string, extra: Partial<SucursalVista> = {}): SucursalVista => ({
  slug,
  nombre: slug,
  ciudad: "Ciudad Ejemplo",
  provincia: "Provincia Ejemplo",
  direccion: "Calle Ejemplo 123",
  horario: "Lunes a viernes de 9 a 18",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 1,
  activa: true,
  predeterminada: false,
  ...extra,
});
const datosSucursales: DatosSucursales = {
  sucursales: [suc("sede-a"), suc("sede-b", { orden: 2, predeterminada: true })],
  zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "sede-a", facturaSucursal: null }],
};

vi.mock("@/lib/auth", () => ({ identidadActual: async () => ({ clerkUserId: null, cliente }) }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => listaPrivada }));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => (await import("@/lib/envio")).CONFIG_ENVIO_DEFAULT,
}));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: async () => datosSucursales }));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));
vi.mock("@/lib/zona-servidor", () => ({ dispDelVisitante: async () => (estadoDisp ? disp : undefined) }));
vi.mock("@/lib/disponibilidad-vista", () => ({
  contextoParaProvincia: async (base: typeof disp) => base,
  disponibilidadParaMostrar: async (...a: unknown[]) => (a[1] ? disponibilidadParaMostrar(...a) : null),
}));

import { POST } from "./route";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "transferencia",
  nombre: "Transferencia",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 1,
  idListaPrecios: "L-DEST",
  destacarEnCatalogo: true,
  mostrarEnFicha: false,
  ...o,
});
const cobroOnline = medio({
  slug: "mercadopago",
  nombre: "Mercado Pago",
  cobroOnline: true,
  orden: 2,
  idListaPrecios: "L1",
  destacarEnCatalogo: false,
  condicionesCuotas: [{ cuotas: 3, idListaPrecios: "L3" }],
});

let n = 0;
const pedir = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `192.0.2.${(n = (n % 200) + 1)}` },
      body: JSON.stringify({ items: [{ id: "1", qty: 2 }], ...extra }),
    }),
  );

const opciones = (i: number) =>
  cotizar.mock.calls[i][1] as { idListaMedio?: string; aPedido?: ReadonlySet<string> };

beforeEach(() => {
  flujo = "normal";
  estadoDisp = false;
  cliente = null;
  listaPrivada = null;
  medios = [medio({}), cobroOnline];
  cotizar.mockReset();
  cotizar.mockImplementation(async () => ({
    lineas: [],
    subtotal: 1000,
    iva: 210,
    costoEnvio: 0,
    total: 1210,
    hayProblemas: false,
    listaPrivada: false,
    flujo,
  }));
  disponibilidadParaMostrar.mockReset();
  disponibilidadParaMostrar.mockResolvedValue({
    productos: {
      "1": {
        servible: true,
        envio: { estado: "por_pedido", demoraDias: 5 },
        retiro: { "sede-a": { estado: "por_pedido", demoraDias: 5 }, "sede-b": { estado: "disponible", demoraDias: 0 } },
      },
      "2": { servible: true, envio: { estado: "disponible", demoraDias: 0 }, retiro: { "sede-a": { estado: "disponible", demoraDias: 0 } } },
    },
    locales: [{ slug: "sede-a", nombre: "Sede A" }],
  });
  setFlag("cuotas-cobro", true);
});

describe("POST /api/carrito/cotizar — venta sin stock", () => {
  it("flag on, traslado apagado: aPedido del motor llega a cotizar y la línea va a pedido", async () => {
    estadoDisp = true;
    await pedir({ entregaTipo: "envio" });
    expect([...opciones(0).aPedido!]).toEqual(["1"]);
    // La disponibilidad se calcula ANTES de cotizar.
    expect(disponibilidadParaMostrar.mock.invocationCallOrder[0]).toBeLessThan(cotizar.mock.invocationCallOrder[0]);
  });

  it("retiro: decide el estado del local elegido o, sin elegir, el de localDeRetiro", async () => {
    estadoDisp = true;
    await pedir({ entregaTipo: "retiro", sucursalRetiro: "sede-b" });
    expect(opciones(0).aPedido!.size).toBe(0);
    cotizar.mockClear();
    // Sin local elegido: la predeterminada (sede-b) sin provincia; la de la zona con provincia.
    await pedir({ entregaTipo: "retiro" });
    expect(opciones(0).aPedido!.size).toBe(0);
    cotizar.mockClear();
    await pedir({ entregaTipo: "retiro", provincia: "Misiones" });
    expect([...opciones(0).aPedido!]).toEqual(["1"]);
  });

  it("flag off (o sin disponibilidad): cotizar decide con el stock de la línea (sin aPedido)", async () => {
    await pedir({ entregaTipo: "envio" });
    expect(opciones(0).aPedido).toBeUndefined();
    estadoDisp = true;
    disponibilidadParaMostrar.mockResolvedValue(null);
    cotizar.mockClear();
    await pedir({ entregaTipo: "envio" });
    expect(opciones(0).aPedido).toBeUndefined();
  });

  it("a_confirmar: recotiza con la lista del destacado y no trae cuotas ni totalesOpciones", async () => {
    flujo = "a_confirmar";
    const body = await (
      await pedir({ pagoMetodo: "mercadopago", conCuotas: true, totalesOpciones: true, cuotas: 1 })
    ).json();
    const ultima = cotizar.mock.calls.length - 1;
    expect(opciones(ultima).idListaMedio).toBe("L-DEST");
    expect(body.flujo).toBe("a_confirmar");
    expect(body.cuotasOpciones).toBeUndefined();
    expect(body.totalesOpciones).toBeUndefined();
    expect(body.proximoEscalon).toBeUndefined();
    expect(body.progresoCuotas).toBeUndefined();
    expect(body.cuentaTransferencia).toBeUndefined();
    expect(body.envio).toBeDefined();
  });

  it("a_confirmar sin destacado: la lista general; tampoco hay barra de cuotas del carrito", async () => {
    flujo = "a_confirmar";
    medios = [medio({ destacarEnCatalogo: false }), cobroOnline];
    const body = await (await pedir({ progresoCuotas: true })).json();
    const ultima = cotizar.mock.calls.length - 1;
    expect(ultima).toBe(1);
    expect(opciones(ultima).idListaMedio).toBeUndefined();
    expect(body.progresoCuotas).toBeUndefined();
  });

  it("a_confirmar con cuenta corriente o lista privada: no recotiza", async () => {
    flujo = "a_confirmar";
    cliente = { codigocliente: "C-1", tipoCuenta: "corriente" };
    await pedir();
    expect(cotizar).toHaveBeenCalledTimes(1);
    cotizar.mockClear();
    cliente = { codigocliente: "C-2" };
    listaPrivada = "lista-privada-a";
    await pedir();
    expect(cotizar).toHaveBeenCalledTimes(1);
  });

  it("en_linea: cotiza con la lista del medio elegido, como siempre", async () => {
    const body = await (await pedir({ pagoMetodo: "mercadopago" })).json();
    expect(cotizar).toHaveBeenCalledTimes(1);
    expect(opciones(0).idListaMedio).toBe("L1");
    expect(body.flujo).toBe("normal");
  });

  it("carrito vacío: flujo normal", async () => {
    const body = await (await POST(
      new Request("https://tienda.example/api/carrito/cotizar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "192.0.2.250" },
        body: JSON.stringify({ items: [] }),
      }),
    )).json();
    expect(body.flujo).toBe("normal");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sin sesión el carrito también cotiza, con la lista principal (L1): el
 * visitante ve el IVA y el total final. La sesión se exige recién para comprar.
 */

let identidad: { clerkUserId: string | null; cliente: { codigocliente: string } | null };
const cotizar = vi.fn();
const idPriceListCliente = vi.fn();
let configEnvio: ConfigEnvio = CONFIG_ENVIO_DEFAULT;

vi.mock("@/lib/auth", () => ({
  identidadActual: async () => identidad,
  idPriceListCliente: (...a: unknown[]) => idPriceListCliente(...a),
}));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: async () => false }));
// La config de envío se relee SIN caché en cada cotización.
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => configEnvio,
}));

import { POST } from "./route";
import { CONFIG_ENVIO_DEFAULT, type ConfigEnvio } from "@/lib/envio";

function pedido(ip = "203.0.113.7") {
  return new Request("https://tienda.example/api/carrito/cotizar", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ items: [{ id: "1", qty: 2 }] }),
  });
}

beforeEach(() => {
  configEnvio = CONFIG_ENVIO_DEFAULT;
  identidad = { clerkUserId: null, cliente: null };
  cotizar.mockReset();
  cotizar.mockResolvedValue({
    lineas: [],
    subtotal: 1000,
    iva: 210,
    costoEnvio: 0,
    total: 1210,
    hayProblemas: false,
  });
  idPriceListCliente.mockReset();
  idPriceListCliente.mockResolvedValue("7");
});

describe("POST /api/carrito/cotizar", () => {
  it("sin sesión cotiza con la lista principal (sin idPriceList)", async () => {
    const r = await POST(pedido());
    expect(r.status).toBe(200);
    expect((await r.json()).total).toBe(1210);
    expect(cotizar).toHaveBeenCalledWith([{ id: "1", qty: 2 }], {
      idPriceList: undefined,
      entregaTipo: "retiro",
    });
    expect(idPriceListCliente).not.toHaveBeenCalled();
  });

  it("con cliente vinculado cotiza con su lista", async () => {
    identidad = { clerkUserId: "user_1", cliente: { codigocliente: "C1" } };
    await POST(pedido());
    expect(cotizar).toHaveBeenCalledWith(expect.any(Array), {
      idPriceList: "7",
      entregaTipo: "retiro",
    });
  });

  it("sin sesión el techo es por IP (frena bots)", async () => {
    for (let i = 0; i < 60; i++) expect((await POST(pedido("203.0.113.3"))).status).toBe(200);
    expect((await POST(pedido("203.0.113.3"))).status).toBe(429);
    // Otra IP no comparte el techo.
    expect((await POST(pedido("203.0.113.4"))).status).toBe(200);
  });
});

describe("POST /api/carrito/cotizar — envío evaluado con la config releída", () => {
  const conProvincia = (provincia?: string) =>
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.50" },
      body: JSON.stringify({ items: [{ id: "1", qty: 2 }], entregaTipo: "envio", provincia }),
    });

  it("gratis apagado: disponible, a coordinar, motivo gratis_apagado", async () => {
    const { envio } = await (await POST(conProvincia("Misiones"))).json();
    expect(envio).toMatchObject({ disponible: true, gratis: false, aCoordinar: true, motivo: "gratis_apagado" });
  });

  it("en alcance con el mínimo cumplido: gratis; bajo el mínimo: dice cuánto falta", async () => {
    configEnvio = { domicilioActivo: true, gratis: { alcance: "provincias", provincias: ["misiones"], minimo: 1000 } };
    expect((await (await POST(conProvincia("Misiones"))).json()).envio).toMatchObject({ gratis: true, motivo: null });
    configEnvio = { domicilioActivo: true, gratis: { alcance: "provincias", provincias: ["misiones"], minimo: 1500 } };
    expect((await (await POST(conProvincia("misiones"))).json()).envio).toMatchObject({
      gratis: false,
      motivo: "bajo_minimo",
      faltante: 500,
    });
  });

  it("sin provincia y alcance por provincias: sin_ubicacion; con el envío inactivo: no disponible", async () => {
    configEnvio = { domicilioActivo: true, gratis: { alcance: "provincias", provincias: ["misiones"], minimo: null } };
    expect((await (await POST(conProvincia())).json()).envio.motivo).toBe("sin_ubicacion");
    configEnvio = { domicilioActivo: false, gratis: null };
    expect((await (await POST(conProvincia("Misiones"))).json()).envio).toMatchObject({ disponible: false, motivo: "inactivo" });
  });
});

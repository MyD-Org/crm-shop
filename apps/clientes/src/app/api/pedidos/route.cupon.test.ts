import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cotizacion } from "@/lib/cotizacion";
import type { ConfigEnvio } from "@/lib/envio";
import type { PromocionCupon } from "@/lib/cupones/tipos";

/**
 * Cupón al confirmar el pedido (spec 2026-11-01-cupones-design.md): el servidor vuelve a validar y a
 * aplicar el cupón con las mismas reglas que el carrito; `totalVisto` corta si el cupón dejó de valer;
 * un canje que se agotó entre la cotización y el POST sale con 409 `motivo: "cupon"`; el envío gratis
 * es la regla de la tienda (sobre el subtotal ANTES del cupón) o el del cupón.
 */

const crearPedido = vi.fn();
const resolverCupon = vi.fn();
let precio = 1000;
let config: ConfigEnvio = { domicilioActivo: true, gratis: null };

let cuponesPermitidos = true;
const clavesLimite: string[] = [];
vi.mock("@/lib/rate-limit", () => ({
  permitirAsync: async (clave: string) => {
    clavesLimite.push(clave);
    return clave.startsWith("cupon:") ? cuponesPermitidos : true;
  },
}));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoRecibido: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente: null, email: "ana@cliente.example" }),
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: async (): Promise<Cotizacion> => ({
    lineas: [{ id: "1", code: null, name: "x", brand: "", qty: 1, precioUnitario: precio, ivaPorcentaje: 0, subtotal: precio, iva: 0, total: precio, stockDisponible: 5 }],
    hayProblemas: false, subtotal: precio, iva: 0, costoEnvio: 0, total: precio, listaPrivada: false, flujo: "normal",
  }),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
const mediosCrm = ["transferencia", "mercadopago"].map((slug, orden) => ({
  slug, nombre: slug === "transferencia" ? "Transferencia" : "Mercado Pago", instrucciones: "", activo: true, aplicaRetiro: true,
  aplicaEnvio: true, cobroOnline: slug === "mercadopago", orden,
}));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => mediosCrm }));
vi.mock("@/lib/sucursales-repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => config,
}));
vi.mock("@/lib/cupones/repo", async (orig) => ({
  ...(await orig<typeof import("@/lib/cupones/repo")>()),
  resolverCupon: (...a: unknown[]) => resolverCupon(...a),
}));

import { CuponCanjeError } from "@/lib/cupones/repo";
import { POST } from "./route";

const promo = (o: Partial<PromocionCupon> = {}): PromocionCupon => ({
  codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot Instagram", tipo: "unicos", pct: 10,
  envioGratis: false, provinciasEnvio: null, inicio: "2026-01-01T00:00:00-03:00", fin: "2099-01-01T00:00:00-03:00",
  venceEn: null, soloPrimeraCompra: true, minimo: null, medios: null, formas: null, permiteCuotas: false,
  limiteCanjes: null, condiciones: "", activa: true, ...o,
});
const valido = (p: PromocionCupon = promo()) => ({ ok: true, promo: p, motivoCuenta: null, verificado: true });

const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: "1", qty: 1 }], contactoNombre: "Ana", contactoTelefono: "123", entregaTipo: "retiro",
        pagoMetodo: "transferencia", ...extra,
      }),
    }),
  );
const conEnvio = { entregaTipo: "envio", entregaCiudad: "Mar del Plata", entregaDireccion: "Calle 1", entregaProvincia: "Buenos Aires" };

beforeEach(() => {
  cuponesPermitidos = true;
  clavesLimite.length = 0;
  precio = 1000;
  config = { domicilioActivo: true, gratis: null };
  crearPedido.mockReset();
  crearPedido.mockImplementation(async () => ({ id: "p1", numero: "PED-1", repetido: false, cuotas: null }));
  resolverCupon.mockReset();
  resolverCupon.mockResolvedValue(valido());
});

describe("POST /api/pedidos con cupón", () => {
  it("total del pedido = total cotizado con cupón; crearPedido recibe la promoción y quién", async () => {
    const r = await post({ cupon: "luz 7kq2m", totalVisto: 900 });
    expect(r.status).toBe(201);
    expect(resolverCupon).toHaveBeenCalledWith("luz 7kq2m", { clerkUserId: "user_1", email: "ana@cliente.example", listaPrivada: false });
    const [, datos, cotizacion] = crearPedido.mock.calls[0] as [unknown, { cupon?: unknown }, Cotizacion];
    expect(cotizacion.total).toBe(900);
    expect(cotizacion.cupon).toMatchObject({ codigo: "LUZ-7KQ2M", descuento: 100 });
    expect(datos.cupon).toEqual({ promo: promo(), quien: { clerkUserId: "user_1", email: "ana@cliente.example", listaPrivada: false }, envioGratisTienda: false });
  });

  it("sin cupón: crearPedido no recibe cupón", async () => {
    expect((await post({ totalVisto: 1000 })).status).toBe(201);
    expect((crearPedido.mock.calls[0][1] as { cupon?: unknown }).cupon).toBeUndefined();
    expect(resolverCupon).not.toHaveBeenCalled();
  });

  it("cupón que dejó de valer con totalVisto que lo incluía: 409 motivo cupon con su mensaje (no «precio cambió»), sin pedido", async () => {
    resolverCupon.mockResolvedValue({ ok: false, error: { motivo: "vencido", mensaje: "Este cupón venció." } });
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.motivo).toBe("cupon");
    expect(j.error).toBe("Este cupón venció. Revise el nuevo total antes de confirmar.");
    expect(j.totalNuevo).toBe(1000);
    expect(j.cotizacion.cuponError).toEqual({ motivo: "vencido", mensaje: "Este cupón venció." });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("cupón visto sin verificar que al confirmar no es primera compra: 409 motivo cupon con ese motivo", async () => {
    resolverCupon.mockResolvedValue({ ...valido(), motivoCuenta: "no_primera_compra" });
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.motivo).toBe("cupon");
    expect(j.error).toBe("Este cupón es sólo para la primera compra en la tienda. Revise el nuevo total antes de confirmar.");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("con el cupón aplicado y el precio cambiado sigue siendo precio_cambio", async () => {
    precio = 1100;
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("precio_cambio");
  });

  it("cupón ilegible (no_disponible): nunca cobra de más sin avisar", async () => {
    resolverCupon.mockResolvedValue({ ok: false, error: { motivo: "no_disponible", mensaje: "No pudimos validar el cupón. Inténtelo de nuevo en un momento." } });
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    expect((await r.json()).cotizacion.cuponError.motivo).toBe("no_disponible");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("canje agotado entre la cotización y el POST: 409 motivo cupon con el mensaje y la cotización sin cupón", async () => {
    crearPedido.mockRejectedValue(new CuponCanjeError("usado"));
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j).toMatchObject({ motivo: "cupon", error: "Este cupón ya fue usado." });
    expect(j.cotizacion.total).toBe(1000);
    expect(j.cotizacion.cupon ?? null).toBeNull();
  });

  it("comparte el límite de consultas de cupón con el carrito: superado, no se lee la base", async () => {
    cuponesPermitidos = false;
    const r = await post({ cupon: "LUZ-7KQ2M", totalVisto: 900 });
    expect(r.status).toBe(409);
    expect(resolverCupon).not.toHaveBeenCalled();
    expect(clavesLimite).toContain("cupon:user_1");
    expect((await r.json()).cotizacion.cuponError.motivo).toBe("no_disponible");
  });

  it("envío gratis del cupón a domicilio en la provincia alcanzada", async () => {
    resolverCupon.mockResolvedValue(valido(promo({ pct: null, envioGratis: true, provinciasEnvio: ["buenosaires"] })));
    expect((await post({ ...conEnvio, cupon: "LUZ-7KQ2M", totalVisto: 1000 })).status).toBe(201);
    expect(crearPedido.mock.calls[0][1]).toMatchObject({ envioGratis: true });
  });

  it("envío gratis de la tienda sobre el subtotal ANTES del cupón", async () => {
    config = { domicilioActivo: true, gratis: { alcance: "pais", provincias: [], minimo: 1000 } };
    expect((await post({ ...conEnvio, cupon: "LUZ-7KQ2M", totalVisto: 900 })).status).toBe(201);
    expect(crearPedido.mock.calls[0][1]).toMatchObject({ envioGratis: true });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cotizacion } from "@/lib/cotizacion";
import type { MedioPago } from "@/lib/medios-pago";
import type { PromocionCupon } from "@/lib/cupones/tipos";
import { setFlag } from "@/test/flags";

/**
 * Cupón del invitado en `/api/carrito/cotizar` (change `compra-como-invitado`, S2a): `invitadoEmail`
 * (opcional) permite aplicar las reglas por cuenta del cupón SIN sesión, sólo con el flag encendido; el
 * tope de consultas sigue siendo por IP. Sin eso, el anónimo cotiza como siempre.
 */

const cotizar = vi.fn(async (): Promise<Cotizacion> => ({
  lineas: [{ id: "1", code: null, name: "Lámpara", brand: "", qty: 1, precioUnitario: 1000, ivaPorcentaje: 21, subtotal: 1000, iva: 210, total: 1210, stockDisponible: 50 }],
  subtotal: 1000, iva: 210, costoEnvio: 0, total: 1210, hayProblemas: false, listaPrivada: false, flujo: "normal",
}));
const resolverCupon = vi.fn();
const identidadActual = vi.fn();
const claves: string[] = [];
let medios: MedioPago[];

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => null }));
vi.mock("@/lib/cotizacion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: []) => cotizar(...a),
}));
vi.mock("@/lib/sucursales-repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursales-repo")>()),
  leerConfigEnvio: async () => ({ domicilioActivo: true, gratis: null }),
}));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/rate-limit", () => ({
  permitirAsync: async (clave: string) => {
    claves.push(clave);
    return true;
  },
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: async () => true }));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));
vi.mock("@/lib/cupones/repo", () => ({
  resolverCupon: (...a: unknown[]) => resolverCupon(...a),
  cuponDelPedido: async () => null,
}));

import { POST } from "./route";

const transferencia: MedioPago = {
  slug: "transferencia", nombre: "Transferencia", instrucciones: "", activo: true, aplicaRetiro: true, aplicaEnvio: true,
  cobroOnline: false, orden: 1, idListaPrecios: "T", destacarEnCatalogo: false, mostrarEnFicha: false,
};
const promo: PromocionCupon = {
  codigoId: "c1", codigo: "LUZ-7KQ2M", promocionId: "p1", nombre: "Bot Instagram", tipo: "unicos", pct: 10,
  envioGratis: false, provinciasEnvio: null, inicio: "2026-01-01T00:00:00-03:00", fin: "2099-01-01T00:00:00-03:00",
  venceEn: null, soloPrimeraCompra: true, minimo: null, medios: null, formas: null, permiteCuotas: false,
  limiteCanjes: null, condiciones: "", activa: true,
};

const ANONIMO = { clerkUserId: null, cliente: null, email: undefined };

const pedir = (extra: Record<string, unknown>) =>
  POST(
    new Request("https://tienda.example/api/carrito/cotizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.9" },
      body: JSON.stringify({ items: [{ id: "1", qty: 1 }], pagoMetodo: "transferencia", cupon: "luz 7kq2m", ...extra }),
    }),
  );

beforeEach(() => {
  medios = [transferencia];
  claves.length = 0;
  resolverCupon.mockReset();
  resolverCupon.mockResolvedValue({ ok: true, promo, motivoCuenta: null, verificado: true });
  identidadActual.mockReset();
  identidadActual.mockResolvedValue(ANONIMO);
  setFlag("compra-invitado", true);
});

describe("cotizar: cupón del invitado", () => {
  it("con el flag encendido y su email, el cupón se valida por email (normalizado) con el tope por IP", async () => {
    const r = await pedir({ invitadoEmail: " Ana@Cliente.example " });
    expect(r.status).toBe(200);
    expect(resolverCupon).toHaveBeenCalledWith("luz 7kq2m", { clerkUserId: null, email: "ana@cliente.example", listaPrivada: false, invitado: true });
    expect(claves).toContain("cupon:ip:198.51.100.9");
  });

  it("flag apagado: el email se ignora y el anónimo cotiza como siempre (sin reglas de cuenta)", async () => {
    setFlag("compra-invitado", false);
    await pedir({ invitadoEmail: "ana@cliente.example" });
    expect(resolverCupon).toHaveBeenCalledWith("luz 7kq2m", null);
  });

  it("sin email o con un email inválido: como siempre", async () => {
    await pedir({});
    await pedir({ invitadoEmail: "no-es-un-email" });
    await pedir({ invitadoEmail: 42 });
    for (const llamada of resolverCupon.mock.calls) expect(llamada[1]).toBeNull();
  });

  it("con sesión, el email del invitado se ignora: manda la cuenta", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: "user_ana", cliente: null, email: "ana@cuenta.example" });
    await pedir({ invitadoEmail: "otro@cliente.example" });
    expect(resolverCupon).toHaveBeenCalledWith("luz 7kq2m", { clerkUserId: "user_ana", email: "ana@cuenta.example", listaPrivada: false });
  });

  it("sin cupón no se mira el email ni el flag", async () => {
    await pedir({ cupon: undefined, invitadoEmail: "ana@cliente.example" });
    expect(resolverCupon).not.toHaveBeenCalled();
  });

  describe("el motivo de la cuenta viaja al cliente", () => {
    it("«una vez por cliente» con el mismo email => cuponError en usted", async () => {
      resolverCupon.mockResolvedValue({ ok: true, promo, motivoCuenta: "usado", verificado: true });
      const j = await (await pedir({ invitadoEmail: "ana@cliente.example" })).json();
      expect(j.cupon).toBeNull();
      expect(j.cuponError).toMatchObject({ motivo: "usado" });
      expect(j.cuponError.mensaje).not.toMatch(/\b(tu|tus|vos|ojo|probá)\b/i);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoAbierto } from "@/lib/pedidos";
import type { EstadoPago, ProveedorPago } from "./tipos";

const registrarCobro = vi.fn();
const descartarReserva = vi.fn();
vi.mock("@/lib/pedidos", () => ({
  registrarCobro: (...a: unknown[]) => registrarCobro(...a),
  descartarReserva: (...a: unknown[]) => descartarReserva(...a),
}));

import { RESERVA_ABANDONADA_MS, resolverIntentoAbierto } from "./intento-abierto";

const cancelarPago = vi.fn();
const consultarPago = vi.fn();
const proveedor = { id: "mercadopago", cancelarPago, consultarPago } as unknown as ProveedorPago;

const estado = (e: EstadoPago["estado"]): EstadoPago => ({ estado: e, referencia: "r1", detalle: "x" });
const AHORA = Date.parse("2026-09-23T12:00:00Z");

const conReferencia: IntentoAbierto = {
  id: "i1",
  proveedor: "mercadopago",
  referencia: "r1",
  creadoEn: new Date(AHORA - 60_000),
};

beforeEach(() => {
  for (const f of [registrarCobro, descartarReserva, cancelarPago, consultarPago]) f.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolverIntentoAbierto", () => {
  it("reserva reciente sin referencia: la ruta todavía la está usando", async () => {
    const r = await resolverIntentoAbierto("p1", { ...conReferencia, referencia: null }, proveedor, AHORA);
    expect(r).toBe("en_curso");
    expect(descartarReserva).not.toHaveBeenCalled();
  });

  it("reserva vieja sin referencia: se da por abandonada", async () => {
    const vieja = { ...conReferencia, referencia: null, creadoEn: new Date(AHORA - RESERVA_ABANDONADA_MS - 1) };
    expect(await resolverIntentoAbierto("p1", vieja, proveedor, AHORA)).toBe("libre");
    expect(descartarReserva).toHaveBeenCalledWith("i1", "reserva_abandonada");
  });

  it("pago pendiente que se cancela: queda registrado como fallido y se libera", async () => {
    cancelarPago.mockResolvedValue(estado("fallido"));
    expect(await resolverIntentoAbierto("p1", conReferencia, proveedor, AHORA)).toBe("libre");
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ referencia: "r1", estado: "fallido" }));
  });

  it("no se pudo cancelar porque ya se aprobó: 'pagado', y el cobro queda registrado", async () => {
    cancelarPago.mockRejectedValue(new Error("400"));
    consultarPago.mockResolvedValue(estado("pagado"));
    expect(await resolverIntentoAbierto("p1", conReferencia, proveedor, AHORA)).toBe("pagado");
    expect(registrarCobro).toHaveBeenCalledWith("p1", expect.objectContaining({ estado: "pagado" }));
  });

  it("sigue pendiente después de intentar cancelarlo: hay que esperar", async () => {
    cancelarPago.mockRejectedValue(new Error("400"));
    consultarPago.mockResolvedValue(estado("pendiente"));
    expect(await resolverIntentoAbierto("p1", conReferencia, proveedor, AHORA)).toBe("en_curso");
  });

  it("el proveedor no responde: hay que esperar, sin tocar la base", async () => {
    cancelarPago.mockRejectedValue(new Error("timeout"));
    consultarPago.mockRejectedValue(new Error("timeout"));
    expect(await resolverIntentoAbierto("p1", conReferencia, proveedor, AHORA)).toBe("en_curso");
    expect(registrarCobro).not.toHaveBeenCalled();
  });
});

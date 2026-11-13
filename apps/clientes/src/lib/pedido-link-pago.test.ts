import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TECHO_LINK_PAGO_MS, VIDA_LINK_EN_LINEA_MS, VIDA_LINK_TRANSFERENCIA_MS, tokenLinkPago, venceEnLinkPago } from "./pedido-link-pago";
import { acuñarTokenCompra, verificarToken } from "./pedido-token";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const T0 = Date.UTC(2026, 10, 1);

beforeEach(() => {
  vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
});
afterEach(() => vi.unstubAllEnvs());

describe("venceEnLinkPago", () => {
  it("reserva finita => vence con la reserva", () => {
    expect(venceEnLinkPago({ creadoEn: T0, reservaVenceEn: T0 + 3_600_000, enLinea: true })).toBe(T0 + 3_600_000);
  });
  it("sin reserva (infinity): 24 h en línea, 7 días transferencia", () => {
    expect(venceEnLinkPago({ creadoEn: T0, reservaVenceEn: null, enLinea: true })).toBe(T0 + VIDA_LINK_EN_LINEA_MS);
    expect(venceEnLinkPago({ creadoEn: T0, reservaVenceEn: null, enLinea: false })).toBe(T0 + VIDA_LINK_TRANSFERENCIA_MS);
  });
  it("techo de 30 días aunque la reserva sea más larga", () => {
    expect(venceEnLinkPago({ creadoEn: T0, reservaVenceEn: T0 + 90 * 86_400_000, enLinea: true })).toBe(T0 + TECHO_LINK_PAGO_MS);
  });
});

describe("tokenLinkPago", () => {
  it("firma un token `pago` de ese pedido que NO sirve como token de compra", () => {
    const t = tokenLinkPago({ orderId: ID, creadoEn: Date.now(), reservaVenceEn: null, enLinea: true })!;
    expect(verificarToken(t, "pago")).toMatchObject({ ok: true, orderId: ID });
    expect(verificarToken(t, "compra")).toEqual({ ok: false, motivo: "proposito" });
  });
  it("un token de compra no sirve como link de pago", () => {
    expect(verificarToken(acuñarTokenCompra(ID).token, "pago")).toEqual({ ok: false, motivo: "proposito" });
  });
  it("vencido, alterado (otro pedido) y de otro tenant se rechazan", () => {
    const t = tokenLinkPago({ orderId: ID, creadoEn: T0, reservaVenceEn: T0 + 1000, enLinea: true })!;
    expect(verificarToken(t, "pago", T0 + 1000)).toEqual({ ok: false, motivo: "vencido" });
    expect(verificarToken(t.replace(ID, OTRO), "pago", T0)).toEqual({ ok: false, motivo: "firma" });
    expect(verificarToken(t, "pago", T0, "tenant-b.example")).toEqual({ ok: false, motivo: "firma" });
    expect(verificarToken(t.slice(0, -1) + "A", "pago", T0).ok).toBe(false);
  });
  it("sin secreto no hay link (el mail sale sin botón)", () => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "");
    expect(tokenLinkPago({ orderId: ID, creadoEn: T0, reservaVenceEn: null, enLinea: true })).toBeNull();
  });
});

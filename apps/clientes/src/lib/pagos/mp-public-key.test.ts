import { afterEach, describe, expect, it, vi } from "vitest";
import { mpPublicKeyPara } from "./mp-public-key";

afterEach(() => vi.unstubAllEnvs());

describe("mpPublicKeyPara (public key del Brick, desde el servidor)", () => {
  it("medio de Mercado Pago: la public key del resolver", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-clave-publica");
    expect(mpPublicKeyPara("mercadopago")).toEqual({ mpPublicKey: "TEST-clave-publica" });
  });

  it("otro medio (Payway, transferencia) o sin clave: nada", () => {
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-clave-publica");
    expect(mpPublicKeyPara("payway")).toEqual({});
    expect(mpPublicKeyPara("transferencia")).toEqual({});
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "");
    expect(mpPublicKeyPara("mercadopago")).toEqual({});
  });
});

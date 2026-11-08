import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_CONTROL_MEDIOS,
  cacheControlMedios,
  getShopMediaR2,
  homeImagenKey,
  resetShopMediaR2,
  shopMediaConfig,
  urlPublicaHome,
} from "./shop-media";

const ENV_OK = {
  R2_SHOP_MEDIA_ACCOUNT_ID: "cuenta",
  R2_SHOP_MEDIA_ACCESS_KEY_ID: "llave",
  R2_SHOP_MEDIA_SECRET_ACCESS_KEY: "secreto",
  R2_SHOP_MEDIA_BUCKET: "shop-media",
  R2_SHOP_MEDIA_PUBLIC_URL: "https://media.plataforma.example/",
};

const UUID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

beforeEach(() => {
  resetShopMediaR2();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetShopMediaR2();
});

describe("shopMediaConfig", () => {
  it("arma la config completa con region auto y sin barra final", () => {
    expect(shopMediaConfig(ENV_OK)).toEqual({
      accountId: "cuenta",
      accessKeyId: "llave",
      secretAccessKey: "secreto",
      bucket: "shop-media",
      region: "auto",
      publicUrl: "https://media.plataforma.example",
    });
  });

  it("es null si falta cualquiera de las credenciales", () => {
    for (const faltante of Object.keys(ENV_OK)) {
      const env = { ...ENV_OK, [faltante]: undefined };
      expect(shopMediaConfig(env), `sin ${faltante}`).toBeNull();
    }
  });

  it("acepta R2_ACCOUNT_ID en vez de R2_SHOP_MEDIA_ACCOUNT_ID", () => {
    const { R2_SHOP_MEDIA_ACCOUNT_ID, ...resto } = ENV_OK;
    void R2_SHOP_MEDIA_ACCOUNT_ID;
    expect(shopMediaConfig({ ...resto, R2_ACCOUNT_ID: "cuenta-vieja" })).toMatchObject({
      accountId: "cuenta-vieja",
    });
  });

  it("no hereda credenciales de otro bucket", () => {
    const env = { R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "otro-bucket" };
    expect(shopMediaConfig(env)).toBeNull();
  });
});

describe("homeImagenKey", () => {
  it("arma la key con tenant, uuid y ancho", () => {
    expect(homeImagenKey("central-led", UUID, 1600)).toBe(`home/central-led/${UUID}-1600.webp`);
  });

  it("lanza con tenantId, id o ancho inválidos", () => {
    expect(() => homeImagenKey("../x", UUID, 1600)).toThrow();
    expect(() => homeImagenKey("central-led", "no-uuid", 1600)).toThrow();
    expect(() => homeImagenKey("central-led", UUID, 800)).toThrow();
  });
});

describe("urlPublicaHome", () => {
  it("compone la url pública", () => {
    expect(urlPublicaHome("home/t/a-1600.webp", "https://media.plataforma.example")).toBe(
      "https://media.plataforma.example/home/t/a-1600.webp",
    );
  });

  it("es null sin base", () => {
    expect(urlPublicaHome("home/t/a-1600.webp", null)).toBeNull();
  });
});

describe("getShopMediaR2", () => {
  it("es null con env incompleta", () => {
    for (const [k, v] of Object.entries(ENV_OK)) vi.stubEnv(k, v);
    vi.stubEnv("R2_SHOP_MEDIA_BUCKET", "");
    expect(getShopMediaR2()).toBeNull();
  });
});

describe("cacheControlMedios", () => {
  it("por defecto es inmutable por un año", () => {
    expect(CACHE_CONTROL_MEDIOS).toBe("public, max-age=31536000, immutable");
    expect(cacheControlMedios({})).toBe(CACHE_CONTROL_MEDIOS);
  });

  it("R2_SHOP_MEDIA_SIN_CACHE_CONTROL=1 lo apaga (interruptor por CORS sin actualizar)", () => {
    expect(cacheControlMedios({ R2_SHOP_MEDIA_SIN_CACHE_CONTROL: "1" })).toBeUndefined();
  });
});

describe("getShopMediaR2 firma Cache-Control", () => {
  it("las subidas al bucket público llevan cache-control firmado y en headers", async () => {
    for (const [k, v] of Object.entries(ENV_OK)) vi.stubEnv(k, v);
    resetShopMediaR2();
    const r2 = getShopMediaR2();
    const { url, headers } = await r2!.presignPut("x/a.webp", { contentType: "image/webp", contentLength: 1, ttlSeconds: 600 });
    expect(headers["cache-control"]).toBe(CACHE_CONTROL_MEDIOS);
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toContain("cache-control");
    vi.unstubAllEnvs();
    resetShopMediaR2();
  });
});

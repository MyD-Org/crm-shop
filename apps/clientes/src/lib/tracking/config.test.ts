import { afterEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { trackingActivo } from "../tracking-flag";
import { configTracking, rewritesPosthog } from "./config";

describe("configTracking", () => {
  it("sin variables: sólo Vercel (ningún proveedor con ID)", () => {
    expect(configTracking({})).toEqual({ metaPixelId: null, ga4Id: null, posthog: null });
  });

  it("toma los IDs válidos, recortados", () => {
    expect(
      configTracking({ META_PIXEL_ID: " 1234567890 ", GA4_MEASUREMENT_ID: "G-ABC123", POSTHOG_KEY: "phc_abc123" }),
    ).toEqual({
      metaPixelId: "1234567890",
      ga4Id: "G-ABC123",
      posthog: { key: "phc_abc123", uiHost: "https://us.posthog.com" },
    });
  });

  it("un ID mal formado apaga ese proveedor (nada de inyectar basura en un script)", () => {
    expect(
      configTracking({ META_PIXEL_ID: "123');alert(1)//", GA4_MEASUREMENT_ID: "UA-1", POSTHOG_KEY: "abc" }),
    ).toEqual({ metaPixelId: null, ga4Id: null, posthog: null });
  });

  it("región EU de PostHog", () => {
    expect(configTracking({ POSTHOG_KEY: "phc_x", POSTHOG_REGION: "EU" }).posthog?.uiHost).toBe("https://eu.posthog.com");
  });
});

describe("rewritesPosthog", () => {
  it("sin key no hay proxy", () => {
    expect(rewritesPosthog({})).toEqual([]);
  });

  it("assets antes que la ingesta, por región", () => {
    expect(rewritesPosthog({ POSTHOG_KEY: "phc_x", POSTHOG_REGION: "eu" })).toEqual([
      { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://eu-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ]);
  });
});

/** Lee el flag `tracking` de Vercel Flags (mockeado en src/test/setup-flags.ts). */
describe("trackingActivo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apagado por defecto", async () => {
    vi.stubEnv("META_PIXEL_ID", "1234567890");
    expect(await trackingActivo()).toBeNull();
  });

  it("prendido: la config de los proveedores cargados", async () => {
    setFlag("tracking", true);
    vi.stubEnv("META_PIXEL_ID", "1234567890");
    expect(await trackingActivo()).toMatchObject({ metaPixelId: "1234567890" });
  });
});

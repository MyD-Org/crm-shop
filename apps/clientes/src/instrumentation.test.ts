import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

describe("instrumentation.register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sin SHOP_TENANT_ID el server no llega a atender", () => {
    vi.stubEnv("NEXT_PHASE", undefined as unknown as string);
    vi.stubEnv("SHOP_TENANT_ID", undefined as unknown as string);
    expect(() => register()).toThrow(/SHOP_TENANT_ID/);
  });

  it("con SHOP_TENANT_ID arranca", () => {
    vi.stubEnv("NEXT_PHASE", undefined as unknown as string);
    vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
    expect(() => register()).not.toThrow();
  });

  it("durante `next build` no exige la variable", () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("SHOP_TENANT_ID", undefined as unknown as string);
    expect(() => register()).not.toThrow();
  });
});

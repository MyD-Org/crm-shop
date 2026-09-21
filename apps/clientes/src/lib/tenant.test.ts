import { afterEach, describe, expect, it, vi } from "vitest";
import { shopTenantId } from "./tenant";

const MENSAJE =
  "Falta SHOP_TENANT_ID en el entorno. El Shop no opera sin tenant: configure la variable (slug de tenants.id).";

describe("shopTenantId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sin la variable falla con un error de configuración, sin valor por defecto", () => {
    vi.stubEnv("SHOP_TENANT_ID", undefined as unknown as string);
    expect(() => shopTenantId()).toThrow(MENSAJE);
  });

  it("vacía o solo espacios es lo mismo que ausente", () => {
    for (const v of ["", "  ", "\t\n"]) {
      vi.stubEnv("SHOP_TENANT_ID", v);
      expect(() => shopTenantId(), JSON.stringify(v)).toThrow(MENSAJE);
    }
  });

  it("recorta los espacios alrededor", () => {
    vi.stubEnv("SHOP_TENANT_ID", " tenant-a ");
    expect(shopTenantId()).toBe("tenant-a");
  });

  it("se lee en cada llamada, no se congela al importar", () => {
    vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
    expect(shopTenantId()).toBe("tenant-a");
    vi.stubEnv("SHOP_TENANT_ID", "tenant-b");
    expect(shopTenantId()).toBe("tenant-b");
  });
});

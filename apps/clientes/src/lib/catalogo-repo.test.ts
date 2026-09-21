import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbGrabadora,
  valoresInsertados,
} from "@/db/__fixtures__/db-grabadora";

/**
 * El estado de la sync del catálogo se guarda por tenant. Antes, sin
 * `SHOP_TENANT_ID`, se escribía bajo un tenant "default" inventado: la sync
 * "andaba" y dejaba su cursor en una fila que nadie iba a volver a leer.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { repoCatalogoDrizzle } from "./catalogo-repo";

const AHORA = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  grabadora = dbGrabadora();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("repoCatalogoDrizzle: tenant", () => {
  it("importar y construir el repo no exige la variable", () => {
    vi.stubEnv("SHOP_TENANT_ID", undefined as unknown as string);
    expect(() => repoCatalogoDrizzle()).not.toThrow();
  });

  it("escribe el estado bajo SHOP_TENANT_ID", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
    await repoCatalogoDrizzle().registrarIntento(AHORA);

    const insert = grabadora.consultas[0];
    expect(insert.sql).toContain('insert into "shop"."catalogo_sync_state"');
    expect(valoresInsertados(insert).tenant).toBe("tenant-a");
  });

  it('sin la variable falla; no existe el tenant "default"', async () => {
    vi.stubEnv("SHOP_TENANT_ID", undefined as unknown as string);
    const repo = repoCatalogoDrizzle();

    await expect(repo.registrarIntento(AHORA)).rejects.toThrow(/SHOP_TENANT_ID/);
    await expect(repo.registrarError("x", AHORA)).rejects.toThrow(/SHOP_TENANT_ID/);
    await expect(
      repo.reemplazarTaxonomia({ categorias: [], tags: [] } as never, AHORA),
    ).rejects.toThrow(/SHOP_TENANT_ID/);
    await expect(repo.aplicarPaginaOverlay([], null, AHORA)).rejects.toThrow(
      /SHOP_TENANT_ID/,
    );

    for (const c of grabadora.consultas) {
      expect(c.params).not.toContain("default");
      expect(c.sql).not.toContain("catalogo_sync_state");
    }
  });
});

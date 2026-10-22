import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * Guarda de tenant de home_content (change `shop-para-avantec`, rebanada 1a).
 *
 * La tabla es de TODAS las tiendas que comparten la base: una consulta que se
 * olvide del tenant lee o pisa el home/footer/legales de otra empresa. Cada
 * función pública que toca home_content tiene que emitir
 * `"home_content"."tenant_id" = $n` (o insertar el tenant) con `shopTenantId()`.
 */

const TENANT = "tenant-guarda";

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

import {
  borrarSeccionHome,
  guardarSeccionHome,
  leerSeccionesHome,
  leerSeccionesHomePorPrefijo,
  leerSeccionHome,
} from "./home-guardar";
import { getContenidoHome } from "./home-datos";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", TENANT);
  grabadora = dbGrabadora();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const FILTRO_TENANT = /"home_content"\."tenant_id" = \$(\d+)/;

function tenantFiltrado(sql: string, params: unknown[]): unknown {
  const m = sql.match(FILTRO_TENANT);
  expect(m, `sin filtro de tenant en: ${sql}`).not.toBeNull();
  return params[Number(m![1]) - 1];
}

describe("home_content filtra por shopTenantId()", () => {
  it("leerSeccionHome", async () => {
    await leerSeccionHome("hero");
    const [c] = grabadora.consultas;
    expect(tenantFiltrado(c.sql, c.params)).toBe(TENANT);
    expect(c.sql).toMatch(/"home_content"\."key" = \$/);
  });

  it("leerSeccionesHome", async () => {
    await leerSeccionesHome(["legal", "footer"]);
    const [c] = grabadora.consultas;
    expect(tenantFiltrado(c.sql, c.params)).toBe(TENANT);
    expect(c.sql).toMatch(/"home_content"\."key" in \(/);
  });

  it("leerSeccionesHomePorPrefijo escapa el prefijo para el like", async () => {
    await leerSeccionesHomePorPrefijo("pagina-marca:");
    const [c] = grabadora.consultas;
    expect(tenantFiltrado(c.sql, c.params)).toBe(TENANT);
    expect(c.sql).toMatch(/"home_content"\."key" like \$/);
    expect(c.params).toContain("pagina-marca:%");
    grabadora = dbGrabadora();
    await leerSeccionesHomePorPrefijo("a_b%");
    expect(grabadora.consultas[0].params).toContain("a\\_b\\%%");
  });

  it("borrarSeccionHome", async () => {
    await borrarSeccionHome("hero");
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^delete from "shop"\."home_content"/);
    expect(tenantFiltrado(c.sql, c.params)).toBe(TENANT);
  });

  it("guardarSeccionHome inserta con el tenant y el upsert resuelve por (tenant_id, key)", async () => {
    grabadora = dbGrabadora(() => [[new Date()]]);
    await guardarSeccionHome("hero", { titulo: "x" });
    const [c] = grabadora.consultas;
    expect(c.sql).toMatch(/^insert into "shop"\."home_content" \([^)]*"tenant_id"/);
    expect(c.params).toContain(TENANT);
    expect(c.sql).toMatch(/on conflict \("tenant_id","key"\) do update/);
  });

  it("getContenidoHome", async () => {
    await getContenidoHome();
    const lectura = grabadora.consultas.find((c) => c.sql.includes('"home_content"'));
    expect(lectura, "no leyó home_content").toBeDefined();
    expect(tenantFiltrado(lectura!.sql, lectura!.params)).toBe(TENANT);
  });
});

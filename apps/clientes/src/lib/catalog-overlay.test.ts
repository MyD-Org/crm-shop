import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, sinLecturaDelArbol } from "@/db/__fixtures__/db-grabadora";

/**
 * Lectura del overlay del CRM en los listados públicos del espejo: join por
 * `alegra_id` para traer nombre y fotos, y el filtro de visibilidad SÓLO con
 * el flag `catalogo-solo-visibles` encendido (fail-closed).
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getCatalogo, getCategorias, getFacetas, getPaginaCatalogo } from "./catalog";
import { setFlag } from "@/test/flags";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  // count(*) = 1 para que la página también dispare la consulta de filas.
  grabadora = dbGrabadora((c) => (c.sql.includes("count(*)") ? [[1]] : []));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const JOIN_OVERLAY =
  /left join "public"\."catalog_overlay" on \("public"\."catalog_overlay"\."alegra_id" = "catalog_products_shop"\."alegra_id" and "public"\."catalog_overlay"\."tenant_id" = \$\d+\)/;

describe("join al overlay", () => {
  it("la página del catálogo trae nombre y fotos del overlay", async () => {
    await getPaginaCatalogo({});
    const [conteo, pagina] = grabadora.consultas;
    expect(conteo.sql).toMatch(JOIN_OVERLAY);
    expect(pagina.sql).toMatch(JOIN_OVERLAY);
    expect(pagina.sql).toContain('"catalog_overlay"."nombre"');
    expect(pagina.sql).toContain('"catalog_overlay"."fotos"');
  });

  it("getCatalogo (home y autocompletado) también", async () => {
    await getCatalogo({ limit: 10 });
    expect(grabadora.consultas[0].sql).toMatch(JOIN_OVERLAY);
    expect(grabadora.consultas[0].sql).toContain('"catalog_overlay"."nombre"');
  });

  it("las facetas joinean el overlay (para poder filtrar por visible)", async () => {
    await getFacetas({});
    for (const c of sinLecturaDelArbol(grabadora.consultas)) expect(c.sql).toMatch(JOIN_OVERLAY);
  });

  it("getCategorias no se toca", async () => {
    await getCategorias();
    for (const c of grabadora.consultas) expect(c.sql).not.toContain("catalog_overlay");
  });
});

/** `"public"."catalog_overlay"."visible" = $n` con `true` en ese parámetro. */
function exigeVisible(c: { sql: string; params: unknown[] }) {
  const m = c.sql.match(/"public"\."catalog_overlay"\."visible" = \$(\d+)/);
  expect(m, c.sql).not.toBeNull();
  expect(c.params[Number(m![1]) - 1]).toBe(true);
}

describe("flag catalogo-solo-visibles", () => {
  it("apagado (default): ninguna consulta filtra por visible", async () => {
    await getPaginaCatalogo({});
    await getCatalogo({ limit: 10 });
    await getFacetas({});
    expect(sinLecturaDelArbol(grabadora.consultas)).toHaveLength(6);
    for (const c of grabadora.consultas) expect(c.sql).not.toContain('"visible"');
  });


  it("encendido: conteo y página exigen visible = true", async () => {
    setFlag("catalogo-solo-visibles", true);
    await getPaginaCatalogo({ filtros: { categorias: ["ILUMINACION"] } });
    expect(grabadora.consultas).toHaveLength(2);
    for (const c of grabadora.consultas) exigeVisible(c);
  });

  it("encendido: getCatalogo (home y autocompletado) exige visible = true", async () => {
    setFlag("catalogo-solo-visibles", true);
    await getCatalogo({ busqueda: "led", limit: 10 });
    exigeVisible(grabadora.consultas[0]);
  });

  it("encendido: las tres facetas exigen visible = true", async () => {
    setFlag("catalogo-solo-visibles", true);
    await getFacetas({ marcas: ["GENROD"] });
    const consultas = sinLecturaDelArbol(grabadora.consultas);
    expect(consultas).toHaveLength(3);
    for (const c of consultas) exigeVisible(c);
  });

  it("encendido: el predicado de precio positivo se mantiene", async () => {
    setFlag("catalogo-solo-visibles", true);
    await getPaginaCatalogo({});
    for (const c of grabadora.consultas) {
      expect(c.sql).toMatch(/coalesce\(\s*case when jsonb_typeof[\s\S]*?\)\s*>\s*0/);
    }
  });

  it("encendido: getCategorias sigue sin tocar el overlay", async () => {
    setFlag("catalogo-solo-visibles", true);
    await getCategorias();
    for (const c of grabadora.consultas) expect(c.sql).not.toContain("catalog_overlay");
  });
});

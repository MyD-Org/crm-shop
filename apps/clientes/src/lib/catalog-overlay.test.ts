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
    await getPaginaCatalogo({ soloVisibles: false });
    const [conteo, pagina] = grabadora.consultas;
    expect(conteo.sql).toMatch(JOIN_OVERLAY);
    expect(pagina.sql).toMatch(JOIN_OVERLAY);
    expect(pagina.sql).toContain('"catalog_overlay"."nombre"');
    expect(pagina.sql).toContain('"catalog_overlay"."fotos"');
  });

  it("getCatalogo (home y autocompletado) también", async () => {
    await getCatalogo({ soloVisibles: false, limit: 10 });
    expect(grabadora.consultas[0].sql).toMatch(JOIN_OVERLAY);
    expect(grabadora.consultas[0].sql).toContain('"catalog_overlay"."nombre"');
  });

  it("las facetas joinean el overlay (para poder filtrar por visible)", async () => {
    await getFacetas({}, false);
    for (const c of sinLecturaDelArbol(grabadora.consultas)) expect(c.sql).toMatch(JOIN_OVERLAY);
  });

  it("getCategorias no se toca", async () => {
    await getCategorias(false);
    for (const c of grabadora.consultas) expect(c.sql).not.toContain("catalog_overlay");
  });
});

/** `"public"."catalog_overlay"."visible" = $n` con `true` en ese parámetro. */
function exigeVisible(c: { sql: string; params: unknown[] }) {
  const m = c.sql.match(/"public"\."catalog_overlay"\."visible" = \$(\d+)/);
  expect(m, c.sql).not.toBeNull();
  expect(c.params[Number(m![1]) - 1]).toBe(true);
}

describe("soloVisibles (flag catalogo-solo-visibles, lo evalúa quien llama)", () => {
  it("la capa de catálogo no lee el flag: manda el argumento", async () => {
    // El flag se evalúa por request afuera de la caché (flagsPublicos) y viaja
    // en la clave; si catalog.ts lo leyera por su cuenta, una entrada cacheada
    // podría quedar con el valor de otro momento.
    setFlag("catalogo-solo-visibles", true);
    await getPaginaCatalogo({ soloVisibles: false });
    for (const c of grabadora.consultas) expect(c.sql).not.toContain('"visible"');
  });

  it("apagado (default): ninguna consulta filtra por visible", async () => {
    await getPaginaCatalogo({ soloVisibles: false });
    await getCatalogo({ soloVisibles: false, limit: 10 });
    await getFacetas({}, false);
    expect(sinLecturaDelArbol(grabadora.consultas)).toHaveLength(6);
    for (const c of grabadora.consultas) expect(c.sql).not.toContain('"visible"');
  });


  it("encendido: conteo y página exigen visible = true", async () => {
    await getPaginaCatalogo({ soloVisibles: true, filtros: { categorias: ["ILUMINACION"] } });
    expect(grabadora.consultas).toHaveLength(2);
    for (const c of grabadora.consultas) exigeVisible(c);
  });

  it("encendido: getCatalogo (home y autocompletado) exige visible = true", async () => {
    await getCatalogo({ soloVisibles: true, busqueda: "led", limit: 10 });
    exigeVisible(grabadora.consultas[0]);
  });

  it("encendido: las tres facetas exigen visible = true", async () => {
    await getFacetas({ marcas: ["GENROD"] }, true);
    const consultas = sinLecturaDelArbol(grabadora.consultas);
    expect(consultas).toHaveLength(3);
    for (const c of consultas) exigeVisible(c);
  });

  it("encendido: el predicado de precio positivo se mantiene", async () => {
    await getPaginaCatalogo({ soloVisibles: true });
    for (const c of grabadora.consultas) {
      expect(c.sql).toMatch(/coalesce\(\s*case when jsonb_typeof[\s\S]*?\)\s*>\s*0/);
    }
  });

  it("encendido: getCategorias sigue sin tocar el overlay", async () => {
    await getCategorias(true);
    for (const c of grabadora.consultas) expect(c.sql).not.toContain("catalog_overlay");
  });
});

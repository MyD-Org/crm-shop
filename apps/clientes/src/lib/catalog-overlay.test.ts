import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * Lectura del overlay del CRM en los listados públicos del espejo: join por
 * `alegra_id` para traer nombre y fotos, y el filtro de visibilidad SÓLO con
 * el flag `SHOP_CATALOGO_SOLO_VISIBLES` encendido (fail-closed).
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getCatalogo, getCategorias, getFacetas, getPaginaCatalogo } from "./catalog";

beforeEach(() => {
  // count(*) = 1 para que la página también dispare la consulta de filas.
  grabadora = dbGrabadora((c) => (c.sql.includes("count(*)") ? [[1]] : []));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const JOIN_OVERLAY =
  /left join "shop"\."catalog_overlay" on "shop"\."catalog_overlay"\."alegra_id" = "shop"\."catalog_products"\."alegra_id"/;

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
    for (const c of grabadora.consultas) expect(c.sql).toMatch(JOIN_OVERLAY);
  });

  it("getCategorias no se toca", async () => {
    await getCategorias();
    for (const c of grabadora.consultas) expect(c.sql).not.toContain("catalog_overlay");
  });
});

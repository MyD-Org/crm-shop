import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * `getProductosPorIds`: productos del espejo por id de Alegra, para las líneas
 * de pedido (y, más adelante, favoritos). Una sola consulta por llamada, con el
 * overlay del CRM joineado, sin orden ni límite. Sin `soloActivos` no filtra
 * por estado ni por visibilidad: un pedido viejo sigue mostrando el nombre de
 * un ítem despublicado.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { getProducto, getProductosPorIds } from "./catalog";

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  grabadora = dbGrabadora();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const JOIN_OVERLAY =
  /left join "public"\."catalog_overlay" on \("public"\."catalog_overlay"\."alegra_id" = "shop"\."catalog_products"\."alegra_id" and "public"\."catalog_overlay"\."tenant_id" = \$\d+\)/;

describe("getProductosPorIds", () => {
  it("una consulta con los ids en un IN y el overlay joineado", async () => {
    await getProductosPorIds(["42", "7"]);
    expect(grabadora.consultas).toHaveLength(1);
    const { sql, params } = grabadora.consultas[0];
    expect(sql).toContain('"shop"."catalog_products"');
    const m = sql.match(/"catalog_products"\."alegra_id" in \(\$(\d+), \$(\d+)\)/);
    expect(m, sql).not.toBeNull();
    expect([params[Number(m![1]) - 1], params[Number(m![2]) - 1]]).toEqual(["42", "7"]);
    expect(sql).toMatch(JOIN_OVERLAY);
    expect(sql).not.toMatch(/ order by /);
    expect(sql).not.toMatch(/ limit /);
  });

  it("sin soloActivos no filtra por estado ni por visible, aunque el flag esté prendido", async () => {
    vi.stubEnv("SHOP_CATALOGO_SOLO_VISIBLES", "1");
    await getProductosPorIds(["42"]);
    const { sql } = grabadora.consultas[0];
    expect(sql).not.toContain('"status"');
    expect(sql).not.toContain('"visible"');
  });

  it("con soloActivos exige status = 'active'", async () => {
    await getProductosPorIds(["42"], { soloActivos: true });
    const { sql, params } = grabadora.consultas[0];
    const m = sql.match(/"catalog_products"\."status" = \$(\d+)/);
    expect(m, sql).not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe("active");
    expect(sql).not.toContain('"visible"');
  });

  it("con soloActivos y el flag de visibles, también visible = true", async () => {
    vi.stubEnv("SHOP_CATALOGO_SOLO_VISIBLES", "1");
    await getProductosPorIds(["42"], { soloActivos: true });
    const { sql, params } = grabadora.consultas[0];
    const m = sql.match(/"catalog_overlay"\."visible" = \$(\d+)/);
    expect(m, sql).not.toBeNull();
    expect(params[Number(m![1]) - 1]).toBe(true);
  });

  it("sin ids no consulta", async () => {
    const productos = await getProductosPorIds([]);
    expect(productos.size).toBe(0);
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("devuelve un Map por id de Alegra con el nombre del overlay, el sku y la foto", async () => {
    vi.stubEnv("SHOP_MEDIA_HOSTS", "media.plataforma.example");
    vi.stubEnv("R2_SHOP_MEDIA_PUBLIC_URL", "https://media.plataforma.example");
    // Fila en el orden de COLUMNAS_CATALOGO: alegraId, name, code, description,
    // brand, prices, stock, ivaPorcentaje, categoryName, overlayNombre, overlayFotos.
    grabadora = dbGrabadora(() => [
      [
        "42",
        "02141N",
        null,
        "LAMPARA LED A60",
        "Marca Ejemplo",
        [{ idPriceList: "1", price: 1000 }],
        "10",
        "21",
        "Iluminación",
        "Lámpara LED A60 9W E27",
        [{ key: "t1/42.jpg", w: 800 }],
      ],
    ]);

    const productos = await getProductosPorIds(["42", "7"]);
    expect([...productos.keys()]).toEqual(["42"]);
    const p = productos.get("42")!;
    expect(p.name).toBe("Lámpara LED A60 9W E27");
    expect(p.sku).toBe("02141N");
    // La url se compone con la base pública de R2 a partir de la key que guarda el CRM.
    expect(p.images).toEqual([{ url: "https://media.plataforma.example/t1/42.jpg", w: 800 }]);
  });
});

/**
 * Ficha pública: sale del espejo, nunca de Alegra. Un id inexistente o
 * despublicado es 404 (null); un error de la base NO se disfraza de "no existe".
 */
describe("getProducto (ficha)", () => {
  it("consulta el espejo con soloActivos y devuelve null si no está", async () => {
    const p = await getProducto("42");
    expect(p).toBeNull();
    expect(grabadora.consultas).toHaveLength(1);
    expect(grabadora.consultas[0].sql).toMatch(/"catalog_products"\."status" = \$\d+/);
  });

  it("id no numérico: null sin consultar", async () => {
    expect(await getProducto("../contacts/1")).toBeNull();
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("si la base falla, tira en vez de devolver null", async () => {
    grabadora = dbGrabadora(() => {
      throw new Error("db caída");
    });
    await expect(getProducto("42")).rejects.toThrow(/Failed query/);
  });
});

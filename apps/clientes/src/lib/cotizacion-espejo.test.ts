import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * `cotizar`: una sola consulta a la vista del CRM (`catalog_products_shop`) y
 * ninguna llamada a Alegra.
 */

const getItem = vi.fn();
vi.mock("./alegra", async (orig) => ({
  ...(await orig<typeof import("./alegra")>()),
  getItem: (...a: unknown[]) => getItem(...a),
}));

// Fila en el orden del select de `leerEspejo`: alegraId, name, code, brand,
// prices, stock, ivaPorcentaje, status, categoryName.
type Fila = [string, string, string | null, string | null, unknown, string | null, string | null, string, string | null];
let filas: Fila[] = [];
let grabadora = dbGrabadora(() => filas);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import { cotizar } from "./cotizacion";

const precios = [
  { idPriceList: "1", name: "General", price: 1000, main: true },
  { idPriceList: "7", name: "Mayorista", price: 800, main: false },
];

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  getItem.mockReset();
  filas = [];
  grabadora = dbGrabadora(() => filas);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cotizar", () => {
  it("una consulta con todos los ids y 0 llamadas a Alegra", async () => {
    filas = [
      ["10", "COD-10", "R10", "Marca X", precios, "5", "21.00", "active", "Cat"],
      ["20", "COD-20", null, null, precios, null, "10.50", "active", "Cat B"],
    ];
    const c = await cotizar(
      [{ id: "10", qty: 2 }, { id: "20", qty: 1 }],
    );

    expect(getItem).not.toHaveBeenCalled();
    expect(grabadora.consultas).toHaveLength(1);
    expect(grabadora.consultas[0].sql).toContain('from "public"."catalog_products_shop"');
    expect(grabadora.consultas[0].sql).not.toContain('"shop"."catalog_products"');
    // El stock que se cotiza es el disponible: descuenta lo reservado por otros pedidos.
    expect(grabadora.consultas[0].sql).toMatch(
      /left join "shop"\."stock_reservado" on \("stock_reservado"\."alegra_item_id" = "catalog_products_shop"\."alegra_id" and "stock_reservado"\."tenant_id" = \$\d+\)/,
    );
    expect(grabadora.consultas[0].sql).toContain('coalesce("stock_reservado"."qty", 0)');

    expect(c.lineas[0]).toMatchObject({ id: "10", code: "R10", brand: "Marca X", precioUnitario: 1000, subtotal: 2000, iva: 420, stockDisponible: 5 });
    // Sin marca cae a la categoría; stock null = no inventariable.
    expect(c.lineas[1]).toMatchObject({ brand: "Cat B", ivaPorcentaje: 10.5, iva: 105, stockDisponible: null });
    expect(c).toMatchObject({ subtotal: 3000, iva: 525, total: 3525, hayProblemas: false });
  });

  it("usa la lista de precios pedida", async () => {
    filas = [["10", "COD-10", null, null, precios, "5", "21", "active", null]];
    const c = await cotizar([{ id: "10", qty: 1 }], { idPriceList: "7" });
    expect(c.lineas[0].precioUnitario).toBe(800);
  });

  it("IVA null en el espejo → IVA por defecto", async () => {
    filas = [["10", "COD-10", null, null, precios, null, null, "active", null]];
    const c = await cotizar([{ id: "10", qty: 1 }]);
    expect(c.lineas[0].ivaPorcentaje).toBe(21);
  });

  it("marca los problemas: ausente, inactivo y stock insuficiente", async () => {
    filas = [
      ["20", "COD-20", null, null, precios, "5", "21", "inactive", null],
      ["30", "COD-30", null, null, precios, "1", "21", "active", null],
    ];
    const c = await cotizar(
      [{ id: "10", qty: 1 }, { id: "20", qty: 1 }, { id: "30", qty: 3 }],
    );
    expect(c.lineas.map((l) => l.problema)).toEqual(["no_encontrado", "inactivo", "stock_insuficiente"]);
    expect(c.hayProblemas).toBe(true);
    expect(c.total).toBe(0);
  });

  it("todo sale de la vista del CRM, del tenant del Shop (stock, precios, estado, marca, categoría e IVA)", async () => {
    filas = [["10", "COD-10", null, null, precios, "8", "21", "active", null]];
    await cotizar([{ id: "10", qty: 1 }]);
    const [{ sql, params }] = grabadora.consultas;
    const where = sql.match(
      /where \("catalog_products_shop"\."tenant_id" = \$(\d+) and "catalog_products_shop"\."alegra_id" in \(\$\d+\)\)/,
    );
    expect(where, sql).not.toBeNull();
    expect(params[Number(where![1]) - 1]).toBe("tenant-test");
    const cat = sql.match(
      /left join "public"\."catalog_categories_shop" on \("catalog_categories_shop"\."alegra_id" = "catalog_products_shop"\."category_alegra_id" and "catalog_categories_shop"\."tenant_id" = \$(\d+)\)/,
    );
    expect(cat, sql).not.toBeNull();
    expect(params[Number(cat![1]) - 1]).toBe("tenant-test");
    expect(sql).toContain('"catalog_products_shop"."precios_alegra"');
    expect(sql).toContain('"catalog_products_shop"."iva_porcentaje"');
    expect(sql).toContain('"catalog_products_shop"."brand"');
    expect(sql).not.toContain("alegra_leido_at");
  });

  it("IVA sumado en la vista (21 + 3 = 24) → el total usa 24 %", async () => {
    filas = [["10", "COD-10", null, null, precios, "8", "24.00", "active", null]];
    const c = await cotizar([{ id: "10", qty: 1 }]);
    expect(c.lineas[0]).toMatchObject({ ivaPorcentaje: 24, subtotal: 1000, iva: 240, total: 1240 });
    expect(c.total).toBe(1240);
  });

  it("el nombre de la línea es el mismo que muestra el catálogo (overlay → descripción → name)", async () => {
    filas = [["10", "Abrazadera", null, null, precios, "8", "21", "active", null]];
    const c = await cotizar([{ id: "10", qty: 1 }]);
    const [{ sql, params }] = grabadora.consultas;
    expect(sql).toContain(
      'coalesce(nullif("public"."catalog_overlay"."nombre", \'\'), nullif("catalog_products_shop"."description", \'\'), "catalog_products_shop"."name")',
    );
    const join = sql.match(/left join "public"\."catalog_overlay" on \(.*?"public"\."catalog_overlay"\."tenant_id" = \$(\d+)\)/);
    expect(join, sql).not.toBeNull();
    expect(params[Number(join![1]) - 1]).toBe("tenant-test");
    expect(c.lineas[0].name).toBe("Abrazadera");
  });

  it("precios crudos de Alegra (los del CRM) resuelven la lista del cliente y la principal", async () => {
    const crudos = [
      { idPriceList: 1, name: "General", price: "1000", main: true },
      { idPriceList: 7, name: "Mayorista", price: 800 },
    ];
    filas = [["10", "COD-10", null, null, crudos, "8", "21", "active", null]];
    const [principal] = (await cotizar([{ id: "10", qty: 1 }])).lineas;
    const [mayorista] = (await cotizar([{ id: "10", qty: 1 }], { idPriceList: "7" })).lineas;
    expect(principal).toMatchObject({ precioUnitario: 1000, stockDisponible: 8 });
    expect(mayorista.precioUnitario).toBe(800);
  });

  it("estado inactivo del CRM → la línea sale como inactiva", async () => {
    filas = [["10", "COD-10", null, null, precios, "8", "21", "inactive", null]];
    const [linea] = (await cotizar([{ id: "10", qty: 1 }])).lineas;
    expect(linea.problema).toBe("inactivo");
  });
});

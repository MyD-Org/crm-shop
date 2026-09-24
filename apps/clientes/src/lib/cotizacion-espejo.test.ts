import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora } from "@/db/__fixtures__/db-grabadora";

/**
 * `cotizar`: una sola consulta a `catalog_products` y ninguna llamada a Alegra.
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
    expect(grabadora.consultas[0].sql).toContain('"shop"."catalog_products"');

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

  it("stock, precios y estado salen de la fuente más fresca (vista del CRM o espejo del Shop)", async () => {
    filas = [["10", "COD-10", null, null, precios, "8", "21", "active", null]];
    await cotizar([{ id: "10", qty: 1 }]);
    const [{ sql, params }] = grabadora.consultas;
    const join = sql.match(
      /left join "public"\."catalog_products_shop" on \("catalog_products_shop"\."alegra_id" = "shop"\."catalog_products"\."alegra_id" and "catalog_products_shop"\."tenant_id" = \$(\d+)\)/,
    );
    expect(join, sql).not.toBeNull();
    expect(params[Number(join![1]) - 1]).toBe("tenant-test");
    expect(sql).toContain('then "catalog_products_shop"."stock" else "shop"."catalog_products"."stock" end');
    expect(sql).toContain('then "catalog_products_shop"."precios_alegra" else "shop"."catalog_products"."prices" end');
    expect(sql).toContain('then "catalog_products_shop"."activo" else "shop"."catalog_products"."status" = \'active\' end');
    // Nombre, marca e IVA siguen siendo del espejo del Shop.
    expect(sql).toContain('"shop"."catalog_products"."iva_porcentaje"');
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

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La sync del catálogo pasa a guardar el IVA de cada ítem. Lo que importa: la
 * columna se escribe en el insert Y en el upsert (si no, los productos ya
 * existentes nunca reciben el backfill), y el precio de lista queda igual.
 */

const inserts: { values: unknown; set?: Record<string, unknown> }[] = [];

vi.mock("@/db", () => {
  const db = {
    insert: () => {
      const registro: { values: unknown; set?: Record<string, unknown> } = { values: null };
      inserts.push(registro);
      const chain = {
        values(v: unknown) {
          registro.values = v;
          return chain;
        },
        returning: async () => [{ id: "log-1" }],
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          registro.set = set;
        },
      };
      return chain;
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return { getDb: () => db };
});

vi.mock("./alegra", () => ({
  listAllCategories: async () => [],
  listAllItems: async () => [
    {
      alegraId: "7",
      code: "LAM-1",
      name: "Lámpara",
      description: null,
      categoryAlegraId: null,
      brand: null,
      prices: [{ idPriceList: "1", name: "General", price: 100000, main: true }],
      stock: 3,
      status: "active",
      ivaPorcentaje: 21,
    },
    {
      alegraId: "8",
      code: null,
      name: "Sin tax",
      description: null,
      categoryAlegraId: null,
      brand: null,
      prices: [{ price: 5000, main: true }],
      stock: null,
      status: "active",
      ivaPorcentaje: null,
    },
  ],
}));

import { catalogProducts } from "@/db/schema";
import { syncCatalog } from "./catalog-sync";

describe("syncCatalog — IVA en el espejo", () => {
  beforeEach(() => {
    inserts.length = 0;
  });

  it("persiste iva_porcentaje y deja el precio de lista igual", async () => {
    const r = await syncCatalog("manual");
    expect(r.ok).toBe(true);

    const productos = inserts.find(
      (i) => Array.isArray(i.values) && (i.values as { alegraId?: string }[])[0]?.alegraId === "7",
    );
    expect(productos, "no se insertaron productos").toBeDefined();
    const filas = productos!.values as Record<string, unknown>[];

    expect(filas[0].ivaPorcentaje).toBe("21");
    expect(filas[0].prices).toEqual([
      { idPriceList: "1", name: "General", price: 100000, main: true },
    ]);
    expect(filas[1].ivaPorcentaje).toBeNull();

    // El upsert también la actualiza: sin esto no hay backfill.
    expect(productos!.set).toHaveProperty("ivaPorcentaje");
  });

  it("la columna existe en el esquema y es nullable", () => {
    expect(catalogProducts.ivaPorcentaje).toBeDefined();
    expect(catalogProducts.ivaPorcentaje.notNull).toBe(false);
  });
});

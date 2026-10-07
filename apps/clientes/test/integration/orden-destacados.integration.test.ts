import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getPaginaCatalogo, type FiltrosCatalogo } from "@/lib/catalog";
import { PATRON_NOMBRE_ACCESORIO, esNombreAccesorio } from "@/lib/catalogo-destacados";
import type { ContextoDisponibilidad } from "@/lib/disponibilidad-contexto";
import { assertLocalTestDb } from "./db-url";

/**
 * Orden "Destacados" (change catalogo-orden-destacados, rebanada B) contra Postgres REAL local:
 * la ventana que intercala subcategorías, los escalones (stock, foto, accesorio) y la paginación
 * estable. Datos inventados.
 *
 * OPT-IN, como facetas-por-tipo (la `shop_test` compartida puede estar desfasada de las migraciones):
 *
 *   ORDEN_SQL=1 TEST_DATABASE_URL=postgres://localhost:5432/shop_test_orden npm run test:integration -- orden-destacados
 */

const TENANT = process.env.SHOP_TENANT_ID!; // lo fija vitest.config.mts (proyecto integration)

const CAT = {
  raiz: "00000000-0000-4000-8000-000000000001",
  a: "00000000-0000-4000-8000-00000000000a",
  b: "00000000-0000-4000-8000-00000000000b",
  c: "00000000-0000-4000-8000-00000000000c",
  otra: "00000000-0000-4000-8000-0000000000ff",
};

const FOTO = [{ key: "foto/x.webp", w: 800 }];

/** id → [nombre, stock, categoría propia, con foto] */
const PRODUCTOS: Record<string, [string, number, string, boolean]> = {
  a1: ["Lampara uno", 40, CAT.a, true],
  a2: ["Lampara dos", 30, CAT.a, true],
  a3: ["Lampara tres", 20, CAT.a, true],
  a4: ["Lampara cuatro", 10, CAT.a, true],
  b1: ["Reflector uno", 50, CAT.b, true],
  b2: ["Reflector dos", 5, CAT.b, true],
  // Accesorio por el nombre, aunque esté en una subcategoría de principales.
  aAcc: ["Acoplador de rieles", 100, CAT.a, true],
  // Accesorio por la categoría.
  c1: ["Riel recto", 100, CAT.c, true],
  aSinFoto: ["Lampara sin foto", 100, CAT.a, false],
  aSinStock: ["Lampara sin stock", 0, CAT.a, true],
  fuera: ["Cable fuera", 100, CAT.otra, true],
};

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants restart identity cascade`);
  });
}

async function sembrar() {
  const db = getDb();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  const categorias: [string, string | null, string, number][] = [
    [CAT.raiz, null, "Iluminacion", 0],
    [CAT.a, CAT.raiz, "Lamparas", 1],
    [CAT.b, CAT.raiz, "Reflectores", 2],
    [CAT.c, CAT.raiz, "Accesorios", 3],
    [CAT.otra, null, "Cables", 1],
  ];
  for (const [id, parent, nombre, orden] of categorias) {
    await db.execute(
      sql`insert into public.shop_categories (id, tenant_id, parent_id, nombre, slug, orden)
          values (${id}, ${TENANT}, ${parent}, ${nombre}, ${nombre.toLowerCase()}, ${orden})`,
    );
  }
  for (const [id, [nombre, stock, categoria, foto]] of Object.entries(PRODUCTOS)) {
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, precios_online)
          values (${TENANT}, ${id}, ${nombre}, ${stock}, 'active', 'active', ${JSON.stringify([{ price: 100, main: true }])}::jsonb)`,
    );
    await db.execute(
      sql`insert into public.catalog_overlay (tenant_id, alegra_id, visible, categoria_id, fotos)
          values (${TENANT}, ${id}, true, ${categoria}, ${JSON.stringify(foto ? FOTO : [])}::jsonb)`,
    );
  }
}

const ILUMINACION: FiltrosCatalogo = { categorias: ["Iluminacion"] };

const pagina = async (opts: { filtros?: FiltrosCatalogo; pagina?: number; porPagina?: number; disp?: ContextoDisponibilidad }) =>
  getPaginaCatalogo({ soloVisibles: false, orden: "destacados", ...opts });

const ids = async (filtros: FiltrosCatalogo, disp?: ContextoDisponibilidad) =>
  (await pagina({ filtros, disp })).productos.map((p) => p.id);

describe.skipIf(process.env.ORDEN_SQL !== "1")("orden destacados en Postgres", () => {
  beforeAll(async () => {
    await limpiar();
    await sembrar();
  });
  afterAll(async () => {
    await limpiar();
    await getDb().$client.end({ timeout: 5 });
  });

  it("intercala subcategorías por ronda; accesorios con foto después; sin foto y sin stock al final", async () => {
    expect(await ids(ILUMINACION)).toEqual([
      "a1", "b1", // ronda 1: Lamparas antes que Reflectores (orden del árbol)
      "a2", "b2",
      "a3",
      "a4",
      "aAcc", "c1", // accesorios con foto (por nombre y por categoría)
      "aSinFoto",
      "aSinStock",
    ]);
  });

  it("con sólo con stock, los sin stock quedan afuera por el filtro, no por el orden", async () => {
    expect(await ids({ ...ILUMINACION, soloStock: true })).not.toContain("aSinStock");
  });

  it("en una hoja (un solo grupo) queda por stock", async () => {
    expect(await ids({ categorias: ["Lamparas"] })).toEqual(["a1", "a2", "a3", "a4", "aAcc", "aSinFoto", "aSinStock"]);
  });

  it("dos páginas consecutivas no repiten ni pierden productos", async () => {
    const todo = await ids(ILUMINACION);
    const p1 = (await pagina({ filtros: ILUMINACION, pagina: 1, porPagina: 4 })).productos.map((p) => p.id);
    const p2 = (await pagina({ filtros: ILUMINACION, pagina: 2, porPagina: 4 })).productos.map((p) => p.id);
    const p3 = (await pagina({ filtros: ILUMINACION, pagina: 3, porPagina: 4 })).productos.map((p) => p.id);
    expect([...p1, ...p2, ...p3]).toEqual(todo);
  });

  it("con stock por sucursal (disp) la ventana con la subconsulta de stock funciona", async () => {
    const disp: ContextoDisponibilidad = { zona: "igz", activas: ["igz"], contarEn: ["igz"], stockHeredado: "igz" };
    const r = await ids(ILUMINACION, disp);
    expect(r).toHaveLength(10);
    expect(r.slice(0, 2)).toEqual(["a1", "b1"]);
    expect(r.at(-1)).toBe("aSinStock");
  });

  it("el patrón de nombre de accesorio da lo mismo en Postgres que en JS", async () => {
    const nombres = [
      "Acoplador de rieles negro",
      "Uniones para cablecanal",
      "Tapón ciego",
      "Terminales de cobre",
      "Kit de fijación para panel",
      "Controles remotos RGB",
      "Panel LED 60x60 con soporte",
      "Tapaluz bastidor",
      "Kit solar 1 kW",
      "Controlador RGB",
      "  ADAPTADOR E27",
    ];
    for (const n of nombres) {
      const [fila] = (await getDb().execute(
        sql`select btrim("shop".immutable_unaccent(lower(${n}))) ~ ${PATRON_NOMBRE_ACCESORIO} as es`,
      )) as unknown as { es: boolean }[];
      expect({ n, es: fila.es }).toEqual({ n, es: esNombreAccesorio(n) });
    }
  });
});

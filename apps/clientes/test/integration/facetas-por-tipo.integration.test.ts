import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getFacetas, getPaginaCatalogo, type FiltrosCatalogo } from "@/lib/catalog";
import type { FacetaClave } from "@/lib/catalogo-facetas-registro";
import { assertLocalTestDb } from "./db-url";

/**
 * Facetas por tipo y filtro estricto `?car=` (change catalogo-filtros-ux, P3) contra Postgres REAL local
 * sobre `public.catalog_atributos`. Datos inventados.
 *
 * OPT-IN, como medidas-sql (la `shop_test` compartida puede estar desfasada de las migraciones):
 *
 *   FACETAS_SQL=1 TEST_DATABASE_URL=postgres://localhost:5432/shop_test_facetas npm run test:integration -- facetas-por-tipo
 */

const TENANT = process.env.SHOP_TENANT_ID!; // lo fija vitest.config.mts (proyecto integration)

/** [clave, valor_num como texto (numeric), valor_texto] */
type Atributo = [clave: string, valorNum: string | null, valorTexto?: string];

const PRODUCTOS: Record<string, { nombre: string; atributos: Atributo[] }> = {
  t1: { nombre: "Termica uno", atributos: [["polos", "2"], ["curva", null, "c"], ["corriente_a", "20"], ["potencia_w", "5"]] },
  t2: { nombre: "Termica dos", atributos: [["polos", "2"], ["curva", null, "b"], ["corriente_a", "25"], ["potencia_w", "50"]] },
  t3: { nombre: "Termica tres", atributos: [["polos", "4"], ["curva", null, "c"], ["potencia_w", "30"]] },
  t4: { nombre: "Termica cuatro sin datos", atributos: [] },
  t5: { nombre: "Termica cinco", atributos: [["polos", "1"], ["curva", null, "c"], ["corriente_a", "16"]] },
  // Mismo valor con otra escala: cuenta junto con "2" en la faceta y lo encuentra el filtro.
  t6: { nombre: "Termica seis", atributos: [["polos", "2.00"], ["medidas_mm", null, "10x20"]] },
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
  for (const [id, p] of Object.entries(PRODUCTOS)) {
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, precios_online)
          values (${TENANT}, ${id}, ${p.nombre}, 10, 'active', 'active', ${JSON.stringify([{ price: 100, main: true }])}::jsonb)`,
    );
    for (const [clave, num, texto] of p.atributos) {
      await db.execute(
        sql`insert into public.catalog_atributos (tenant_id, alegra_id, clave, valor_num, valor_texto, fuente)
            values (${TENANT}, ${id}, ${clave}, ${num}::numeric, ${texto ?? null}, 'manual')`,
      );
    }
  }
}

const BASE: FiltrosCatalogo = { texto: { q: "termica" }, atributosEstructurados: true, facetasPorTipo: true };

const ids = async (filtros: FiltrosCatalogo) =>
  (await getPaginaCatalogo({ soloVisibles: false, filtros: { ...BASE, ...filtros } })).productos.map((p) => p.id).sort();

const porClave = async (filtros: FiltrosCatalogo) => (await getFacetas({ ...BASE, ...filtros }, false)).porClave;

const lista = (fs: FacetaClave[] | undefined, clave: string) => {
  const f = fs?.find((x) => x.clave === clave);
  return f && f.control === "lista" ? Object.fromEntries(f.items.map((i) => [i.valor, i.count])) : undefined;
};

describe.skipIf(process.env.FACETAS_SQL !== "1")("facetas por tipo sobre catalog_atributos", () => {
  beforeAll(async () => {
    await limpiar();
    await sembrar();
  });
  afterAll(async () => {
    await limpiar();
    await getDb().$client.end({ timeout: 5 });
  });

  it("sin car: cuenta cada valor (la escala del numeric no parte un valor en dos)", async () => {
    const fs = await porClave({});
    expect(lista(fs, "polos")).toEqual({ "1": 1, "2": 3, "4": 1 });
    expect(lista(fs, "curva")).toEqual({ b: 1, c: 3 });
    expect(fs?.some((f) => f.clave === ("medidas_mm" as string))).toBe(false);
  });

  it("R6 paridad: el conteo de Polos: 2 es exactamente lo que devuelve la página (el sin dato no aparece)", async () => {
    const conteo = lista(await porClave({}), "polos")!["2"];
    const r = await ids({ caracteristicas: ["polos:2"] });
    expect(r).toEqual(["t1", "t2", "t6"]);
    expect(r).toHaveLength(conteo);
  });

  it("R6 OR dentro de la clave", async () => {
    expect(await ids({ caracteristicas: ["polos:2", "polos:4"] })).toEqual(["t1", "t2", "t3", "t6"]);
  });

  it("R7: la propia clave se cuenta sin su filtro; las otras, con él", async () => {
    const fs = await porClave({ caracteristicas: ["polos:2"] });
    expect(lista(fs, "polos")).toEqual({ "1": 1, "2": 3, "4": 1 });
    expect(lista(fs, "curva")).toEqual({ b: 1, c: 1 });
  });

  it("R7 cruce de dos claves y paridad con la página", async () => {
    const fs = await porClave({ caracteristicas: ["polos:2", "curva:c"] });
    expect(lista(fs, "polos")).toEqual({ "1": 1, "2": 1, "4": 1 });
    expect(lista(fs, "curva")).toEqual({ b: 1, c: 1 });
    expect(await ids({ caracteristicas: ["polos:2", "curva:c"] })).toEqual(["t1"]);
  });

  it("la potencia (potencia_min/max) es una clave activa más: cruza a las otras y su rango sale sin su filtro", async () => {
    const fs = await porClave({ potenciaMin: 20 });
    expect(lista(fs, "polos")).toEqual({ "2": 1, "4": 1 });
    const pot = fs?.find((f) => f.clave === "potencia_w");
    expect(pot && pot.control === "rango" ? pot.rango : undefined).toEqual({ min: 5, max: 50 });
    expect(await ids({ potenciaMin: 20 })).toEqual(["t2", "t3"]);
  });

  it("sin categoría, búsqueda ni car: no se consulta y sale vacío", async () => {
    expect(await getFacetas({ atributosEstructurados: true, facetasPorTipo: true }, false)).toMatchObject({ porClave: [] });
  });

  it("flag apagado: sin porClave y car se ignora", async () => {
    expect((await getFacetas({ ...BASE, facetasPorTipo: false, caracteristicas: ["polos:2"] }, false)).porClave).toBeUndefined();
    expect(await ids({ facetasPorTipo: false, caracteristicas: ["polos:2"] })).toHaveLength(6);
  });
});

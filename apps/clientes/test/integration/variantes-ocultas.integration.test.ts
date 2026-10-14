import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getCatalogo, getIdAlternativoDeVariante, getProductosPorIds, getVariantesDeGrupo } from "@/lib/catalog";
import { assertLocalTestDb } from "./db-url";

/**
 * Variante oculta por el admin (`catalog_overlay.oculta_en_tienda`) o inactiva en Alegra, contra
 * Postgres REAL local: el selector, el listado, el mapa de carrito/favoritos y la variante
 * alternativa de la ficha. Datos inventados.
 *
 * La columna la crea la migración 0087 del CRM; mientras la rama no la tenga, `global-setup.ts` agrega
 * un parche marcado que se quita solo cuando llega la migración real.
 */

const TENANT = process.env.SHOP_TENANT_ID!;

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants restart identity cascade`);
  });
}

const PRECIOS = JSON.stringify([{ price: 100, main: true }]);

/** Variante del grupo g1: id → [etiqueta, representante, activa en Alegra]. */
const VARIANTES: Record<string, [string, boolean, boolean]> = {
  "11": ["Blanco", true, true],
  "12": ["Cálido", false, true],
  "13": ["Frío", false, true],
  "14": ["Rojo", false, false], // inactiva en Alegra
};

async function oculta(id: string, valor: boolean) {
  await getDb().execute(
    sql`update public.catalog_overlay set oculta_en_tienda = ${valor} where tenant_id = ${TENANT} and alegra_id = ${id}`,
  );
}

beforeAll(async () => {
  await limpiar();
  const db = getDb();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  // El modelo (padre, nunca activo) y el overlay del ancla, que es el que manda en el grupo.
  await db.execute(
    sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, tipo, grupo_id, precios_online)
        values (${TENANT}, 'g1', 'Cinta LED', 0, 'active', 'active', 'padre', 'g1', ${PRECIOS}::jsonb)`,
  );
  await db.execute(
    sql`insert into public.catalog_overlay (tenant_id, alegra_id, visible, fotos) values (${TENANT}, 'g1', true, '[]'::jsonb)`,
  );
  for (const [id, [etiqueta, rep, activa]] of Object.entries(VARIANTES)) {
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, tipo, grupo_id, etiqueta, es_representante, precios_online)
          values (${TENANT}, ${id}, ${"Cinta LED " + etiqueta}, 10, 'active', ${activa ? "active" : "inactive"}, 'variante', 'g1', ${etiqueta}, ${rep}, ${PRECIOS}::jsonb)`,
    );
    // Overlay propio de cada variante (donde el admin la oculta), distinto del del grupo.
    await db.execute(
      sql`insert into public.catalog_overlay (tenant_id, alegra_id, visible, fotos) values (${TENANT}, ${id}, true, '[]'::jsonb)`,
    );
  }
  // Suelto, para probar que lo que no está oculto sigue igual.
  await db.execute(
    sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, tipo, precios_online)
        values (${TENANT}, '99', 'Suelto', 5, 'active', 'active', 'simple', ${PRECIOS}::jsonb)`,
  );
});

afterAll(async () => {
  await limpiar();
  await getDb().$client.end({ timeout: 5 });
});

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("variantes ocultables en la tienda", () => {
  it("nada oculto: el selector trae las activas (la inactiva de Alegra no)", async () => {
    expect(ids(await getVariantesDeGrupo("g1", { soloVisibles: false }))).toEqual(["11", "12", "13"]);
  });

  it("oculta la 12: sale del selector, del listado y del mapa de carrito/favoritos", async () => {
    await oculta("12", true);
    expect(ids(await getVariantesDeGrupo("g1", { soloVisibles: false }))).toEqual(["11", "13"]);
    const listado = await getCatalogo({ soloVisibles: false, limit: 50 });
    expect(ids(listado)).not.toContain("12");
    expect(ids(listado)).toContain("13");
    expect(ids(listado)).toContain("99");
    const mapa = await getProductosPorIds(["11", "12", "13", "14"], { soloActivos: true });
    expect([...mapa.keys()].sort()).toEqual(["11", "13"]);
    // Sin soloActivos (el carrito la conserva para que la cotización la marque): sigue estando.
    expect((await getProductosPorIds(["12"])).has("12")).toBe(true);
  });

  it("ocultar una variante no toca a las demás ni al modelo; destapar la devuelve", async () => {
    await oculta("12", false);
    expect(ids(await getVariantesDeGrupo("g1", { soloVisibles: false }))).toEqual(["11", "12", "13"]);
  });

  it("la ficha de una variante oculta o inactiva redirige a una opción disponible (la representante)", async () => {
    await oculta("11", true);
    expect(await getIdAlternativoDeVariante("11", { soloVisibles: false })).toBe("12");
    expect(await getIdAlternativoDeVariante("14", { soloVisibles: false })).toBe("12");
    await oculta("11", false);
    expect(await getIdAlternativoDeVariante("14", { soloVisibles: false })).toBe("11");
  });

  it("sin ninguna opción disponible no hay alternativa (404)", async () => {
    for (const id of ["11", "12", "13"]) await oculta(id, true);
    expect(await getIdAlternativoDeVariante("11", { soloVisibles: false })).toBeNull();
    expect(await getVariantesDeGrupo("g1", { soloVisibles: false })).toEqual([]);
    for (const id of ["11", "12", "13"]) await oculta(id, false);
  });

  it("la fila del grupo en true no es la de la variante: oculta_en_tienda del ancla no esconde a las hijas", async () => {
    await oculta("g1", true);
    expect(ids(await getVariantesDeGrupo("g1", { soloVisibles: false }))).toEqual(["11", "12", "13"]);
    await oculta("g1", false);
  });
});

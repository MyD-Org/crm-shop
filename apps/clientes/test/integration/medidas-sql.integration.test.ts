import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getPaginaCatalogo, type FiltrosCatalogo } from "@/lib/catalog";
import { assertLocalTestDb } from "./db-url";

/**
 * Medidas (ids dinámicos de atributo `corriente_a:20`) contra Postgres REAL local: "sin
 * contradicción" (NOT EXISTS), positivo y boost sobre `public.catalog_atributos`. Datos inventados.
 *
 * OPT-IN: se escribió sin poder correrlo contra una base (la sesión que lo armó no tenía DB), así
 * que no corre por defecto. Para activarlo (paso U6 de busqueda-medidas):
 *
 *   MEDIDAS_SQL=1 npm run test:integration -- medidas-sql
 *
 * Si el sembrado no encaja con el esquema actual de `public` (vista `catalog_products_shop`),
 * ajustar `sembrar` y sacar el `skipIf`.
 */

const TENANT = process.env.SHOP_TENANT_ID!; // lo fija vitest.config.mts (proyecto integration)

type Atributo = [clave: string, valorNum: number | null, valorTexto?: string];

/** id → { nombre, atributos estructurados }. Los precios del espejo viven en `raw->price` (la vista). */
const PRODUCTOS: Record<string, { nombre: string; atributos: Atributo[] }> = {
  t1: { nombre: "Termica bipolar uno", atributos: [["polos", 2], ["corriente_a", 20]] },
  t2: { nombre: "Termica bipolar dos", atributos: [["polos", 2], ["corriente_a", 25]] },
  t3: { nombre: "Termica sin dato tres", atributos: [] },
  t4: { nombre: "Termica 20A cuatro", atributos: [] },
  t5: { nombre: "Termica unipolar cinco", atributos: [["polos", 1], ["corriente_a", 16]] },
  f1: { nombre: "Foco exterior ip44", atributos: [["ip", 44]] },
  f2: { nombre: "Foco exterior ip65", atributos: [["ip", 65]] },
  f3: { nombre: "Foco exterior ip67", atributos: [["ip", 67]] },
  f4: { nombre: "Foco exterior sin dato", atributos: [] },
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
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, raw)
          values (${TENANT}, ${id}, ${p.nombre}, 10, 'active', ${JSON.stringify({ price: [{ price: 100, main: true }] })}::jsonb)`,
    );
    for (const [clave, num, texto] of p.atributos) {
      await db.execute(
        sql`insert into public.catalog_atributos (tenant_id, alegra_id, clave, valor_num, valor_texto, fuente)
            values (${TENANT}, ${id}, ${clave}, ${num}, ${texto ?? null}, 'manual')`,
      );
    }
  }
}

const ids = async (filtros: FiltrosCatalogo, orden?: "relevancia") => {
  const pagina = await getPaginaCatalogo({
    soloVisibles: false,
    filtros: { atributosEstructurados: true, ...filtros },
    ...(orden ? { orden } : {}),
  });
  return pagina.productos.map((p) => p.id);
};

describe.skipIf(process.env.MEDIDAS_SQL !== "1")("medidas dinámicas sobre catalog_atributos", () => {
  beforeAll(async () => {
    await limpiar();
    await sembrar();
  });
  afterAll(async () => {
    await limpiar();
    await getDb().$client.end({ timeout: 5 });
  });

  it("con universo (búsqueda): pasan el que cumple y el que no tiene dato; no el que contradice", async () => {
    const r = await ids({ busqueda: "termica", atributos: ["corriente_a:20"] });
    expect(r.sort()).toEqual(["t1", "t3", "t4"]);
  });

  it("dos claves: AND entre ellas (t2 contradice la corriente aunque tenga los polos)", async () => {
    const r = await ids({ busqueda: "termica", atributos: ["polos:2", "corriente_a:20"] });
    expect(r.sort()).toEqual(["t1", "t3", "t4"]);
  });

  it("dos valores de una misma clave: OR (corriente 20 o 25)", async () => {
    const r = await ids({ busqueda: "termica", atributos: ["corriente_a:20", "corriente_a:25"] });
    expect(r.sort()).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("sin universo (?atr=corriente_a:20 a mano): positivo, sólo el dato o el patrón del nombre", async () => {
    const r = await ids({ atributos: ["corriente_a:20"] });
    expect(r.sort()).toEqual(["t1", "t4"]);
  });

  it("ip: pedido o superior; el sin dato pasa en el modo sin contradicción", async () => {
    const r = await ids({ busqueda: "foco", atributos: ["ip:65"] });
    expect(r.sort()).toEqual(["f2", "f3", "f4"]);
  });

  it("el boost sube a los que SÍ tienen el dato (estructurado o nombre) sobre los que no", async () => {
    const r = await ids(
      {
        busqueda: "termica",
        categorias: [],
        atributos: [],
        planBusqueda: {
          consulta: "termica 20a",
          blandos: {
            categorias: [],
            atributos: [{ id: "corriente_a:20", peso: 1 }],
            terminos: [{ texto: "termica", peso: 1 }],
          },
        },
      },
      "relevancia",
    );
    expect(r).toHaveLength(5);
    expect(r.slice(0, 2).sort()).toEqual(["t1", "t4"]);
  });

  it("conClaves: sólo productos con dato de la clave (cobertura)", async () => {
    expect((await ids({ busqueda: "termica", conClaves: ["polos"] })).sort()).toEqual(["t1", "t2", "t5"]);
  });

  // R4.8 (p95 <= 1.25x contra el mismo filtro con ids del diccionario, sobre 3000 productos
  // sintéticos): no se automatiza acá; se mide en la corrida del banco con el flag prendido (M3).
});

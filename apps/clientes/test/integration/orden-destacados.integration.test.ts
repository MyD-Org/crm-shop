import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
  otraHoja: "00000000-0000-4000-8000-0000000000fe",
};

const FOTO = [{ key: "foto/x.webp", w: 800 }];

/**
 * id → [nombre, stock, categoría propia, con foto, precio]. Dentro de una subcategoría manda el
 * precio en tramos (×√10), no el stock bruto: a1..a4 tienen precios de tramos distintos.
 */
const PRODUCTOS: Record<string, [string, number, string, boolean, number]> = {
  a1: ["Lampara uno", 10, CAT.a, true, 100000],
  a2: ["Lampara dos", 20, CAT.a, true, 10000],
  a3: ["Lampara tres", 30, CAT.a, true, 1000],
  a4: ["Lampara cuatro", 900, CAT.a, true, 100],
  // La más cara, pero con stock corto: escalón aparte, después de los principales con stock holgado.
  aPocoStock: ["Lampara poco stock", 1, CAT.a, true, 500000],
  b1: ["Reflector uno", 50, CAT.b, true, 1000],
  b2: ["Reflector dos", 5, CAT.b, true, 100],
  // Accesorio por el nombre, aunque esté en una subcategoría de principales.
  aAcc: ["Acoplador de rieles", 100, CAT.a, true, 100],
  // Accesorio por la categoría.
  c1: ["Riel recto", 100, CAT.c, true, 100],
  aSinFoto: ["Lampara sin foto", 100, CAT.a, false, 100],
  aSinStock: ["Lampara sin stock", 0, CAT.a, true, 100],
  fuera: ["Cable unipolar", 100, CAT.otraHoja, true, 100],
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
    [CAT.otraHoja, CAT.otra, "Unipolares", 1],
  ];
  for (const [id, parent, nombre, orden] of categorias) {
    await db.execute(
      sql`insert into public.shop_categories (id, tenant_id, parent_id, nombre, slug, orden)
          values (${id}, ${TENANT}, ${parent}, ${nombre}, ${nombre.toLowerCase()}, ${orden})`,
    );
  }
  for (const [id, [nombre, stock, categoria, foto, precio]] of Object.entries(PRODUCTOS)) {
    await db.execute(
      sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, precios_online)
          values (${TENANT}, ${id}, ${nombre}, ${stock}, 'active', 'active', ${JSON.stringify([{ price: precio, main: true }])}::jsonb)`,
    );
    await db.execute(
      sql`insert into public.catalog_overlay (tenant_id, alegra_id, visible, categoria_id, fotos)
          values (${TENANT}, ${id}, true, ${categoria}, ${JSON.stringify(foto ? FOTO : [])}::jsonb)`,
    );
  }
}

/** Marca destacados del admin (`catalog_overlay.orden`): id → posición (9999 = sin posición). */
async function destacar(posiciones: Record<string, number>) {
  for (const [id, orden] of Object.entries(posiciones)) {
    await getDb().execute(
      sql`update public.catalog_overlay set orden = ${orden} where tenant_id = ${TENANT} and alegra_id = ${id}`,
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
      "aPocoStock", // stock corto: después de los holgados aunque sea el más caro, antes de los accesorios
      "aAcc", "c1", // accesorios con foto (por nombre y por categoría)
      "aSinFoto",
      "aSinStock",
    ]);
  });

  it("con sólo con stock, los sin stock quedan afuera por el filtro, no por el orden", async () => {
    expect(await ids({ ...ILUMINACION, soloStock: true })).not.toContain("aSinStock");
  });

  it("en una hoja (un solo grupo) queda por stock holgado y precio", async () => {
    expect(await ids({ categorias: ["Lamparas"] })).toEqual(["a1", "a2", "a3", "a4", "aPocoStock", "aAcc", "aSinFoto", "aSinStock"]);
  });

  it("sin categoría alterna raíces: una de cada raíz antes de repetir", async () => {
    expect((await ids({})).slice(0, 3)).toEqual(["a1", "fuera", "b1"]);
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
    expect(r).toHaveLength(11);
    expect(r.slice(0, 2)).toEqual(["a1", "b1"]);
    expect(r.at(-1)).toBe("aSinStock");
  });

  describe("destacados manuales (catalog_overlay.orden)", () => {
    afterEach(async () => {
      await getDb().execute(sql`update public.catalog_overlay set orden = null where tenant_id = ${TENANT}`);
    });

    it("un destacado sale primero en su categoría aunque sea accesorio (gana a todas las claves automáticas)", async () => {
      await destacar({ c1: 1 });
      expect((await ids({ categorias: ["Accesorios"] }))[0]).toBe("c1");
      expect((await ids(ILUMINACION))[0]).toBe("c1");
    });

    it("el destacado de una subcategoría sale primero en la raíz (ancestras) y sin categoría", async () => {
      await destacar({ b2: 1 });
      expect((await ids(ILUMINACION))[0]).toBe("b2");
      expect((await ids({}))[0]).toBe("b2");
    });

    it("menor posición primero; el resto sigue el orden automático", async () => {
      await destacar({ b2: 2, a4: 1 });
      const r = await ids(ILUMINACION);
      expect(r.slice(0, 2)).toEqual(["a4", "b2"]);
      expect(r.slice(2)).toEqual(["a1", "b1", "a2", "a3", "aPocoStock", "aAcc", "c1", "aSinFoto", "aSinStock"]);
    });

    it("9999 (sin posición) empata entre destacados y se ordenan por las claves automáticas", async () => {
      await destacar({ a3: 9999, b2: 9999 });
      // b2 es el 2.º de su subcategoría (ronda 2) y a3 el 3.º de la suya (ronda 3).
      expect((await ids(ILUMINACION)).slice(0, 2)).toEqual(["b2", "a3"]);
    });

    it("una posición explícita gana a un 9999", async () => {
      await destacar({ a1: 9999, c1: 5 });
      expect((await ids(ILUMINACION)).slice(0, 2)).toEqual(["c1", "a1"]);
    });

    it("sólo ordena: un destacado de otra categoría no entra y los filtros siguen mandando", async () => {
      await destacar({ fuera: 1 });
      const r = await ids(ILUMINACION);
      expect(r).not.toContain("fuera");
      expect(r).toHaveLength(11);
      expect(await ids({ ...ILUMINACION, soloStock: true })).not.toContain("aSinStock");
    });

    it("con orden=nombre los destacados no cambian nada (alfabético)", async () => {
      await destacar({ c1: 1 });
      const r = (await getPaginaCatalogo({ soloVisibles: false, orden: "nombre", filtros: ILUMINACION })).productos.map((p) => p.id);
      expect(r.indexOf("c1")).toBeGreaterThan(0);
    });

    it("dos páginas consecutivas no repiten ni pierden productos con destacados", async () => {
      await destacar({ c1: 1, b2: 2, a3: 9999 });
      const todo = await ids(ILUMINACION);
      const paginas = [];
      for (const n of [1, 2, 3]) paginas.push(...(await pagina({ filtros: ILUMINACION, pagina: n, porPagina: 4 })).productos.map((p) => p.id));
      expect(paginas).toEqual(todo);
      expect(todo.slice(0, 3)).toEqual(["c1", "b2", "a3"]);
    });

    it("con stock por sucursal (disp) los destacados también van primero", async () => {
      await destacar({ c1: 1 });
      const disp: ContextoDisponibilidad = { zona: "igz", activas: ["igz"], contarEn: ["igz"], stockHeredado: "igz" };
      expect((await ids(ILUMINACION, disp))[0]).toBe("c1");
    });
  });

  describe("venta sin stock (modalidad activa asignada a aSinStock y b2)", () => {
    const MOD = "00000000-0000-4000-8000-0000000000d1";
    beforeAll(async () => {
      await getDb().execute(
        sql`insert into public.modalidades_sin_stock (id, tenant_id, nombre, texto, plazo_dias, flujo)
            values (${MOD}, ${TENANT}, 'Modalidad 48 h', 'Modalidad 48 h', 2, 'en_linea')`,
      );
      await getDb().execute(
        sql`update public.catalog_overlay set modalidad_sin_stock_id = ${MOD}
            where tenant_id = ${TENANT} and alegra_id in ('aSinStock', 'b2')`,
      );
    });
    afterAll(async () => {
      await getDb().execute(sql`update public.catalog_overlay set modalidad_sin_stock_id = null where tenant_id = ${TENANT}`);
      await getDb().execute(sql`delete from public.modalidades_sin_stock where tenant_id = ${TENANT}`);
    });

    it("sin contexto: el a pedido pesa como stock corto y entra en 'sólo con stock'", async () => {
      expect(await ids(ILUMINACION)).toEqual([
        "a1", "b1", "a2", "b2", "a3", "a4",
        "aPocoStock", "aSinStock", // escalón "stock corto": el a pedido después del más caro
        "aAcc", "c1",
        "aSinFoto",
      ]);
      const r = await pagina({ filtros: { ...ILUMINACION, soloStock: true } });
      const aPedido = r.productos.find((p) => p.id === "aSinStock");
      expect(aPedido?.stock).toBe("out");
      expect(aPedido?.ventaSinStock?.texto).toBe("Modalidad 48 h");
      // b2 tiene stock: lleva la modalidad pero no es a pedido.
      expect(r.productos.find((p) => p.id === "b2")?.stock).not.toBe("out");
    });

    // Retiro en "otra": ningún producto tiene filas por sucursal, así que el stock de la vista es de
    // "igz" (`stockHeredado`) y en "otra" todo vale 0. b2 (stock 5 en igz) lo cubre otra sucursal;
    // aSinStock no lo tiene nadie.
    const retiroOtra: ContextoDisponibilidad = {
      zona: "igz",
      activas: ["igz", "otra"],
      contarEn: ["otra"],
      stockHeredado: "igz",
      local: "otra",
    };

    it("retiro con traslado: lo que otra sucursal cubre no es a pedido (escalón y filtro con la unión)", async () => {
      const disp: ContextoDisponibilidad = { ...retiroOtra, traslado: true };
      const todo = await ids(ILUMINACION, disp);
      expect(todo).toHaveLength(11);
      expect(todo[0]).toBe("aSinStock");
      const r = await pagina({ filtros: { ...ILUMINACION, soloStock: true }, disp });
      expect(r.productos.map((p) => p.id)).toEqual(["aSinStock"]);
      expect(r.total).toBe(1);
      expect(r.productos[0].ventaSinStock?.texto).toBe("Modalidad 48 h");
      const b2 = (await pagina({ filtros: { categorias: ["Reflectores"] }, disp })).productos.find((p) => p.id === "b2");
      expect(b2?.stock).toBe("out");
      expect(b2?.ventaSinStock).toBeUndefined();
    });

    it("retiro sin traslado (bloquear): la modalidad aplica aunque otra sucursal lo tenga", async () => {
      const r = await pagina({ filtros: { ...ILUMINACION, soloStock: true }, disp: retiroOtra });
      expect(r.productos.map((p) => p.id)).toEqual(["aSinStock", "b2"]);
      expect(r.productos.every((p) => p.stock === "out" && p.ventaSinStock)).toBe(true);
    });
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
      "UNIÓN PARA CAÑO",
      "TAPÓN CIEGO",
      "Kit de instalación",
    ];
    for (const n of nombres) {
      const [fila] = (await getDb().execute(
        sql`select btrim(lower(${n})) ~ ${PATRON_NOMBRE_ACCESORIO} as es`,
      )) as unknown as { es: boolean }[];
      expect({ n, es: fila.es }).toEqual({ n, es: esNombreAccesorio(n) });
    }
  });
});

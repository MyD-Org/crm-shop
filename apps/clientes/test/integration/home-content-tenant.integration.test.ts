import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assertLocalTestDb } from "./db-url";

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

import { borrarSeccionHome, guardarSeccionHome, leerSeccionesHome, leerSeccionHome } from "@/lib/home-guardar";
import { getContenidoHome } from "@/lib/home-datos";
import { DEFAULTS_HOME } from "@/data/home-defaults";

/**
 * home_content por tenant contra Postgres REAL (local), sobre la migración 0037 (fase expand: la PK sigue
 * siendo `key`; el índice único (tenant_id, key) respalda el ON CONFLICT). Datos inventados.
 *
 * "Misma key en dos tenants" recién es posible con la 0038 (PK compuesta): ver el `it.todo` del final.
 */

const T1 = "tenant-uno";
const T2 = "tenant-dos";

function como<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
  vi.stubEnv("SHOP_TENANT_ID", tenant);
  return fn();
}

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().execute(sql`truncate table shop.home_content`);
}

beforeEach(async () => {
  await limpiar();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await limpiar();
});

describe("home_content por tenant", () => {
  it("lo que guarda T1 no lo lee T2", async () => {
    await como(T1, () => guardarSeccionHome("hero", { titulo: "De uno" }));
    expect(await como(T1, () => leerSeccionHome("hero"))).toEqual({ titulo: "De uno" });
    expect(await como(T2, () => leerSeccionHome("hero"))).toBeUndefined();
  });

  it("guardar dos veces la misma key del mismo tenant actualiza (no duplica ni falla)", async () => {
    await como(T1, () => guardarSeccionHome("hero", { v: 1 }));
    await como(T1, () => guardarSeccionHome("hero", { v: 2 }));
    expect(await como(T1, () => leerSeccionHome("hero"))).toEqual({ v: 2 });
    const [{ n }] = (await getDb().execute(sql`select count(*)::int as n from shop.home_content`)) as unknown as { n: number }[];
    expect(n).toBe(1);
  });

  it("borrar la sección de T1 no toca la de T2", async () => {
    await como(T1, () => guardarSeccionHome("hero", { de: "uno" }));
    await como(T2, () => guardarSeccionHome("footer", { de: "dos" }));
    await como(T1, () => borrarSeccionHome("hero"));
    expect(await como(T1, () => leerSeccionHome("hero"))).toBeUndefined();
    expect(await como(T2, () => leerSeccionHome("footer"))).toEqual({ de: "dos" });
    // Borrar con la key de otro tenant no borra nada del otro.
    await como(T1, () => borrarSeccionHome("footer"));
    expect(await como(T2, () => leerSeccionHome("footer"))).toEqual({ de: "dos" });
  });

  it("legal y footer quedan aislados", async () => {
    await como(T1, () => guardarSeccionHome("legal", { razonSocial: "Empresa Uno SA" }));
    await como(T1, () => guardarSeccionHome("footer", { descripcion: "Uno" }));
    const t2 = await como(T2, () => leerSeccionesHome(["legal", "footer"]));
    expect(t2.size).toBe(0);
    const t1 = await como(T1, () => leerSeccionesHome(["legal", "footer"]));
    expect([...t1.keys()].sort()).toEqual(["footer", "legal"]);
  });

  it("un tenant nuevo sin filas ve los defaults, no el contenido del otro", async () => {
    await como(T1, () => guardarSeccionHome("anuncio", { texto: "Anuncio exclusivo de uno" }));
    const t1 = await como(T1, () => getContenidoHome());
    expect(t1.anuncio.texto).toBe("Anuncio exclusivo de uno");
    const t2 = await como(T2, () => getContenidoHome());
    expect(t2).toEqual(DEFAULTS_HOME);
  });

  it.todo("misma key en dos tenants convive (requiere la PK compuesta de la 0038, rebanada 1b)");
});

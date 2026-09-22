import { describe, expect, it } from "vitest";
import {
  bannerDestino,
  esRolDeRuntime,
  leerUrlMigracion,
  mensajeRolDeRuntime,
} from "./migrate-destino";

const URL_DUENO =
  "postgres://owner_role:s3cr3t-placeholder@db.cliente.example:5432/crm";

describe("leerUrlMigracion", () => {
  it("sin MIGRATE_DATABASE_URL falla nombrando la variable, aunque haya otras URLs", () => {
    const env = {
      DATABASE_URL: "postgres://shop_app:x@otra.cliente.example:5432/crm",
      POSTGRES_URL_NON_POOLING: "postgres://u:x@vieja.cliente.example:5432/shop",
      POSTGRES_URL: "postgres://u:x@vieja-pooler.cliente.example:5432/shop",
    };
    expect(() => leerUrlMigracion(env)).toThrow(/MIGRATE_DATABASE_URL/);
    expect(() => leerUrlMigracion(env)).toThrow(
      "Falta MIGRATE_DATABASE_URL. Las migraciones del Shop usan SOLO esa variable (conexión directa, rol dueño). No se usa DATABASE_URL ni POSTGRES_URL*."
    );
  });

  it("vacía o en blanco cuenta como ausente", () => {
    expect(() => leerUrlMigracion({ MIGRATE_DATABASE_URL: "" })).toThrow(
      /Falta MIGRATE_DATABASE_URL/
    );
    expect(() => leerUrlMigracion({ MIGRATE_DATABASE_URL: "   " })).toThrow(
      /Falta MIGRATE_DATABASE_URL/
    );
  });

  it("devuelve la URL y el host cuando es una conexión directa", () => {
    const destino = leerUrlMigracion({ MIGRATE_DATABASE_URL: URL_DUENO });
    expect(destino.url).toBe(URL_DUENO);
    expect(destino.host).toBe("db.cliente.example");
  });

  it("rechaza el host del pooler", () => {
    const env = {
      MIGRATE_DATABASE_URL:
        "postgres://owner_role:s3cr3t-placeholder@ep-algo-pooler.cliente.example:5432/crm",
    };
    expect(() => leerUrlMigracion(env)).toThrow(
      'MIGRATE_DATABASE_URL apunta al pooler. Use la conexión directa (sin "-pooler").'
    );
  });

  it("una URL mal formada falla sin repetir su contenido (puede traer la clave)", () => {
    const env = { MIGRATE_DATABASE_URL: "s3cr3t-placeholder sin esquema" };
    let mensaje = "";
    try {
      leerUrlMigracion(env);
    } catch (err) {
      mensaje = (err as Error).message;
    }
    expect(mensaje).toMatch(/MIGRATE_DATABASE_URL/);
    expect(mensaje).not.toContain("s3cr3t-placeholder");
  });

  it("ningún mensaje de error incluye la clave", () => {
    const env = {
      MIGRATE_DATABASE_URL:
        "postgres://owner_role:s3cr3t-placeholder@ep-algo-pooler.cliente.example:5432/crm",
    };
    try {
      leerUrlMigracion(env);
    } catch (err) {
      expect((err as Error).message).not.toContain("s3cr3t-placeholder");
    }
  });
});

describe("bannerDestino", () => {
  it("muestra host, base y rol; nunca la clave ni la URL completa", () => {
    const { host } = leerUrlMigracion({ MIGRATE_DATABASE_URL: URL_DUENO });
    const banner = bannerDestino({ host, base: "crm", rol: "owner_role" });
    expect(banner).toBe(
      "[db:migrate] destino → host=db.cliente.example base=crm rol=owner_role esquema=shop tabla=shop.__drizzle_migrations"
    );
    expect(banner).not.toContain("s3cr3t-placeholder");
    expect(banner).not.toContain(URL_DUENO);
  });
});

describe("esRolDeRuntime", () => {
  it("shop_app no migra aunque tuviera CREATE", () => {
    expect(esRolDeRuntime("shop_app", true)).toBe(true);
  });

  it("un rol sin CREATE sobre la base no migra", () => {
    expect(esRolDeRuntime("otro_rol", false)).toBe(true);
  });

  it("el rol dueño con CREATE sí migra", () => {
    expect(esRolDeRuntime("owner_role", true)).toBe(false);
  });

  it("el mensaje nombra al rol y pide el dueño", () => {
    expect(mensajeRolDeRuntime("shop_app")).toBe(
      'El rol "shop_app" es de runtime y no puede migrar. Use el rol dueño.'
    );
  });
});

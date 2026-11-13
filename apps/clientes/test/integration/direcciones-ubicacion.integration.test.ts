import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { actualizarDireccion, crearDireccion, direccionParaEnvio } from "@/lib/direcciones-envio-db";
import type { DatosDireccion } from "@/lib/direcciones-envio";
import { assertLocalTestDb } from "./db-url";

/**
 * Direcciones guardadas con ubicación (change `envio-por-zona-con-tarifa`, rebanada C) contra Postgres
 * REAL local: se guardan lat/lon de un token verificado; editar sin token conserva la ubicación sólo si
 * la calle no cambió; una calle distinta la borra.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const USUARIO = "user_ubicacion";

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.direcciones_envio restart identity cascade`);
  });
}

const datos = (extra: Partial<DatosDireccion> = {}): DatosDireccion => ({
  etiqueta: "Casa",
  calle: "Av. Colón 2500",
  ciudad: "Mar del Plata",
  provincia: "Buenos Aires",
  cp: "7600",
  referencias: null,
  predeterminada: false,
  ...extra,
});

describe("direcciones con ubicación", () => {
  beforeEach(limpiar);
  afterAll(limpiar);

  it("guarda lat/lon al crear con ubicación y las lee sólo el servidor", async () => {
    const d = await crearDireccion(USUARIO, datos(), { lat: -37.99, lon: -57.55 });
    expect(d).not.toHaveProperty("lat");
    expect(await direccionParaEnvio(USUARIO, d.id)).toMatchObject({ lat: -37.99, lon: -57.55 });
    expect(TENANT).toBeTruthy();
  });

  it("sin ubicación al crear queda sin coordenadas", async () => {
    const d = await crearDireccion(USUARIO, datos());
    expect(await direccionParaEnvio(USUARIO, d.id)).toMatchObject({ lat: null, lon: null });
  });

  it("editar sin token con la misma calle conserva la ubicación", async () => {
    const d = await crearDireccion(USUARIO, datos(), { lat: -37.99, lon: -57.55 });
    await actualizarDireccion(USUARIO, d.id, datos({ etiqueta: "Trabajo" }));
    expect(await direccionParaEnvio(USUARIO, d.id)).toMatchObject({ lat: -37.99, lon: -57.55 });
  });

  it("editar la calle sin token nuevo borra la ubicación", async () => {
    const d = await crearDireccion(USUARIO, datos(), { lat: -37.99, lon: -57.55 });
    await actualizarDireccion(USUARIO, d.id, datos({ calle: "Av. Luro 100" }));
    expect(await direccionParaEnvio(USUARIO, d.id)).toMatchObject({ lat: null, lon: null });
  });

  it("editar la calle con un token nuevo guarda la ubicación nueva", async () => {
    const d = await crearDireccion(USUARIO, datos(), { lat: -37.99, lon: -57.55 });
    await actualizarDireccion(USUARIO, d.id, datos({ calle: "Av. Luro 100" }), { lat: -38.0, lon: -57.56 });
    expect(await direccionParaEnvio(USUARIO, d.id)).toMatchObject({ lat: -38, lon: -57.56 });
  });
});

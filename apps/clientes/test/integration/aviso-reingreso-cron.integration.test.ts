import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { hayDisponible, productosAvisables } from "@/lib/aviso-reingreso-disponibilidad";
import { procesarAvisos, type DependenciasAvisos } from "@/lib/aviso-reingreso-cron";
import {
  bajaPorToken,
  insertarAviso,
  listarPendientesDe,
  marcarAvisado,
  marcarError,
  pendientesAgrupados,
  purgar,
  reclamarAviso,
  type FilaAviso,
} from "@/lib/aviso-reingreso-repo";
import type { SucursalDato } from "@/lib/sucursales";
import { assertLocalTestDb } from "./db-url";

/**
 * Cron, repo y baja del aviso de reingreso (change `aviso-reingreso`, S2) contra Postgres REAL (local,
 * datos inventados): el reclamo atómico, marcar solo tras el envío, reintentos, la baja idempotente, la
 * purga de retención, el disponible (bruto − reservado) y el barrido completo con el envío simulado.
 */

const TENANT = process.env.SHOP_TENANT_ID!;
const OTRO = "otro-tenant";
const db = getDb();

const fila = (o: Partial<FilaAviso> = {}): FilaAviso => ({
  tenantId: TENANT,
  alegraId: "P1",
  email: "ana@cliente.example",
  whatsapp: null,
  cantidad: 1,
  quiereEncargar: false,
  consentimientoContacto: false,
  clerkUserId: null,
  ...o,
});

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants, shop.avisos_reingreso, shop.order_items, shop.orders restart identity cascade`);
  });
}

async function producto(id: string, stock: number | null, extra: { status?: string; nombre?: string } = {}) {
  const precios = [{ idPriceList: "1", name: "General", price: 100, main: true }];
  await db.execute(
    sql`insert into public.catalog_products (tenant_id, alegra_id, name, stock, status, alegra_status, iva_porcentaje, precios_online)
        values (${TENANT}, ${id}, ${extra.nombre ?? `Producto ${id}`}, ${stock}, ${extra.status ?? "active"}, ${extra.status ?? "active"}, 21, ${JSON.stringify(precios)}::jsonb)`,
  );
}

const estado = async (id: string) =>
  ((await db.execute(
    sql`select avisado_at, unsubscribed_at, avisando_en, intentos, email_error from shop.avisos_reingreso where id = ${id}`,
  )) as unknown as { avisado_at: Date | null; unsubscribed_at: Date | null; avisando_en: Date | null; intentos: number; email_error: string | null }[])[0];

const tokenDe = async (id: string) =>
  ((await db.execute(sql`select token_baja from shop.avisos_reingreso where id = ${id}`)) as unknown as { token_baja: string }[])[0].token_baja;

beforeEach(async () => {
  await limpiar();
  await db.execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
});
afterAll(async () => {
  await limpiar();
  await db.$client.end({ timeout: 5 });
});

describe("reclamar, marcar y reintentar", () => {
  it("dos reclamos del mismo aviso: solo uno lo toma", async () => {
    const { id } = await insertarAviso(db, fila());
    const [a, b] = await Promise.all([reclamarAviso(db, TENANT, id), reclamarAviso(db, TENANT, id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await estado(id)).intentos).toBe(1);
  });

  it("un reclamo vencido (más de 30 minutos) se puede volver a tomar; uno reciente no", async () => {
    const { id } = await insertarAviso(db, fila());
    expect(await reclamarAviso(db, TENANT, id)).toBe(true);
    expect(await reclamarAviso(db, TENANT, id)).toBe(false);
    await db.execute(sql`update shop.avisos_reingreso set avisando_en = now() - interval '31 minutes' where id = ${id}`);
    expect(await reclamarAviso(db, TENANT, id)).toBe(true);
  });

  it("marcarAvisado deja avisado_at y limpia error y reclamo; después no se vuelve a reclamar", async () => {
    const { id } = await insertarAviso(db, fila());
    await reclamarAviso(db, TENANT, id);
    await marcarError(db, TENANT, id, "falló");
    await reclamarAviso(db, TENANT, id);
    await marcarAvisado(db, TENANT, id);
    const e = await estado(id);
    expect(e.avisado_at).not.toBeNull();
    expect(e.email_error).toBeNull();
    expect(e.avisando_en).toBeNull();
    expect(await reclamarAviso(db, TENANT, id)).toBe(false);
  });

  it("marcarError guarda el motivo, no marca avisado_at y libera el reclamo para reintentar", async () => {
    const { id } = await insertarAviso(db, fila());
    await reclamarAviso(db, TENANT, id);
    await marcarError(db, TENANT, id, "No se pudo enviar el email");
    const e = await estado(id);
    expect(e).toMatchObject({ avisado_at: null, avisando_en: null, email_error: "No se pudo enviar el email", intentos: 1 });
    expect(await reclamarAviso(db, TENANT, id)).toBe(true);
  });

  it("con devolverIntento (proveedor sin configurar) no gasta el intento", async () => {
    const { id } = await insertarAviso(db, fila());
    await reclamarAviso(db, TENANT, id);
    await marcarError(db, TENANT, id, "Email no configurado", { devolverIntento: true });
    expect((await estado(id)).intentos).toBe(0);
  });

  it("tras 5 intentos fallidos deja de reclamarse y de listarse", async () => {
    const { id } = await insertarAviso(db, fila());
    for (let i = 0; i < 5; i++) {
      expect(await reclamarAviso(db, TENANT, id)).toBe(true);
      await marcarError(db, TENANT, id, "falló");
    }
    expect(await reclamarAviso(db, TENANT, id)).toBe(false);
    expect(await pendientesAgrupados(db, TENANT)).toEqual([]);
  });

  it("aislamiento por tenant: no se reclama ni se marca un aviso de otro tenant", async () => {
    const { id } = await insertarAviso(db, fila({ tenantId: OTRO }));
    expect(await reclamarAviso(db, TENANT, id)).toBe(false);
    await marcarAvisado(db, TENANT, id);
    expect((await estado(id)).avisado_at).toBeNull();
  });
});

describe("pendientes", () => {
  it("agrupa por producto, ignora avisados, bajas y reclamos vigentes, y es del tenant", async () => {
    const a = await insertarAviso(db, fila({ alegraId: "P1" }));
    await insertarAviso(db, fila({ alegraId: "P1", email: "b@cliente.example" }));
    const c = await insertarAviso(db, fila({ alegraId: "P2" }));
    const d = await insertarAviso(db, fila({ alegraId: "P3" }));
    const e = await insertarAviso(db, fila({ alegraId: "P4" }));
    await insertarAviso(db, fila({ alegraId: "P5", tenantId: OTRO }));
    await marcarAvisado(db, TENANT, c.id);
    await bajaPorToken(db, TENANT, await tokenDe(d.id));
    await reclamarAviso(db, TENANT, e.id);
    void a;
    expect(await pendientesAgrupados(db, TENANT)).toEqual(["P1"]);
  });

  it("listarPendientesDe respeta el límite y va por antigüedad", async () => {
    const primero = await insertarAviso(db, fila({ email: "a@cliente.example" }));
    await db.execute(sql`update shop.avisos_reingreso set created_at = now() - interval '2 days' where id = ${primero.id}`);
    await insertarAviso(db, fila({ email: "b@cliente.example" }));
    await insertarAviso(db, fila({ email: "c@cliente.example" }));
    const dos = await listarPendientesDe(db, TENANT, ["P1"], 2);
    expect(dos).toHaveLength(2);
    expect(dos[0].id).toBe(primero.id);
    expect(await listarPendientesDe(db, TENANT, [], 5)).toEqual([]);
    expect(await listarPendientesDe(db, TENANT, ["P1"], 0)).toEqual([]);
  });
});

describe("bajaPorToken", () => {
  it("da de baja, es idempotente (conserva la primera fecha) y el aviso deja de ser pendiente", async () => {
    const { id } = await insertarAviso(db, fila());
    const token = await tokenDe(id);
    expect(await bajaPorToken(db, TENANT, token)).toBe(true);
    const primera = (await estado(id)).unsubscribed_at;
    expect(primera).not.toBeNull();
    expect(await bajaPorToken(db, TENANT, token)).toBe(true);
    expect((await estado(id)).unsubscribed_at).toEqual(primera);
    expect(await pendientesAgrupados(db, TENANT)).toEqual([]);
  });

  it("token inexistente, vacío o de otro tenant: false", async () => {
    const { id } = await insertarAviso(db, fila({ tenantId: OTRO }));
    expect(await bajaPorToken(db, TENANT, "no-existe")).toBe(false);
    expect(await bajaPorToken(db, TENANT, "")).toBe(false);
    expect(await bajaPorToken(db, TENANT, await tokenDe(id))).toBe(false);
  });
});

describe("purgar (retención)", () => {
  it("borra avisados/bajas de más de 180 días y pendientes de más de 365; el resto queda", async () => {
    const vieja = await insertarAviso(db, fila({ alegraId: "A" }));
    const reciente = await insertarAviso(db, fila({ alegraId: "B" }));
    const baja = await insertarAviso(db, fila({ alegraId: "C" }));
    const pendNueva = await insertarAviso(db, fila({ alegraId: "D" }));
    const pendVieja = await insertarAviso(db, fila({ alegraId: "E" }));
    const pendMedia = await insertarAviso(db, fila({ alegraId: "F" }));
    const deOtro = await insertarAviso(db, fila({ alegraId: "G", tenantId: OTRO }));
    await db.execute(sql`update shop.avisos_reingreso set avisado_at = now() - interval '181 days' where id = ${vieja.id}`);
    await db.execute(sql`update shop.avisos_reingreso set avisado_at = now() - interval '179 days' where id = ${reciente.id}`);
    await db.execute(sql`update shop.avisos_reingreso set unsubscribed_at = now() - interval '200 days' where id = ${baja.id}`);
    await db.execute(sql`update shop.avisos_reingreso set created_at = now() - interval '366 days' where id = ${pendVieja.id}`);
    await db.execute(sql`update shop.avisos_reingreso set created_at = now() - interval '300 days' where id = ${pendMedia.id}`);
    await db.execute(sql`update shop.avisos_reingreso set avisado_at = now() - interval '400 days' where id = ${deOtro.id}`);

    expect(await purgar(db, TENANT)).toBe(3);
    const quedan = ((await db.execute(sql`select id from shop.avisos_reingreso`)) as unknown as { id: string }[]).map((r) => r.id);
    expect(new Set(quedan)).toEqual(new Set([reciente.id, pendNueva.id, pendMedia.id, deOtro.id]));
  });
});

describe("hayDisponible y productosAvisables", () => {
  const suc = (slug: string, orden: number): SucursalDato => ({
    slug, aceptaRetiro: true, aceptaEnvio: true, envioCiudades: [], orden, activa: true, predeterminada: orden === 1,
  });
  const DOS = [suc("igz", 1), suc("mdp", 2)];

  it("sin sucursales usa stock − reservado; NULL y agotado no cuentan", async () => {
    await producto("A", 0);
    await producto("B", 4);
    await producto("N", null);
    expect([...(await hayDisponible(["A", "B", "N", "X"], { sucursales: [] }))]).toEqual(["B"]);
  });

  it("con sucursales suma el disponible de las vendibles (stock bruto no alcanza si está reservado)", async () => {
    await producto("M", 0);
    await db.execute(sql`insert into public.sucursales (tenant_id, slug, nombre) values (${TENANT}, 'igz', 'Iguazú'), (${TENANT}, 'mdp', 'Mar del Plata')`);
    await db.execute(sql`insert into public.catalog_stock_sucursal (tenant_id, sucursal, alegra_id, stock, origen) values (${TENANT}, 'igz', 'M', 1, 'manual'), (${TENANT}, 'mdp', 'M', 0, 'manual')`);
    expect((await hayDisponible(["M"], { sucursales: DOS })).has("M")).toBe(true);
    await db.execute(sql`update public.catalog_stock_sucursal set stock = 0 where alegra_id = 'M'`);
    expect((await hayDisponible(["M"], { sucursales: DOS })).has("M")).toBe(false);
  });

  it("procesa más de 100 ids en tandas", async () => {
    await producto("Z1", 3);
    const ids = ["Z1", ...Array.from({ length: 150 }, (_, i) => `NOEXISTE${i}`)];
    expect([...(await hayDisponible(ids, { sucursales: [] }))]).toEqual(["Z1"]);
  });

  it("productosAvisables: solo los que se ven en la tienda, con su nombre", async () => {
    await producto("V1", 2, { nombre: "Lámpara" });
    await producto("OFF", 2, { status: "inactive" });
    const m = await productosAvisables(["V1", "OFF", "NOEXISTE"]);
    expect([...m.keys()]).toEqual(["V1"]);
    expect(m.get("V1")?.nombre).toBe("Lámpara");
  });
});

describe("procesarAvisos (barrido completo, envío simulado)", () => {
  const deps = (o: Partial<DependenciasAvisos> = {}): DependenciasAvisos & { enviar: ReturnType<typeof vi.fn> } => {
    const enviar = vi.fn(async () => ({ ok: true, id: "r1" }));
    return {
      db,
      tenantId: TENANT,
      activo: async () => true,
      sucursales: async () => [],
      sitio: () => "https://tienda.example",
      marca: async () => ({ nombre: "Tienda Ejemplo", logoUrl: null }),
      ...o,
      enviar: (o.enviar as never) ?? enviar,
    } as never;
  };

  it("flag apagado: sale sin enviar ni marcar (y no consulta stock)", async () => {
    await producto("P1", 5);
    const { id } = await insertarAviso(db, fila());
    const d = deps({ activo: async () => false });
    const r = await procesarAvisos(d);
    expect(r).toMatchObject({ omitido: true, enviados: 0 });
    expect(d.enviar).not.toHaveBeenCalled();
    expect((await estado(id)).avisado_at).toBeNull();
  });

  it("sin pendientes no consulta sucursales ni envía", async () => {
    const sucursales = vi.fn(async () => []);
    const d = deps({ sucursales });
    expect(await procesarAvisos(d)).toMatchObject({ revisados: 0, enviados: 0 });
    expect(sucursales).not.toHaveBeenCalled();
  });

  it("producto que sigue agotado: no envía y el aviso queda pendiente", async () => {
    await producto("P1", 0);
    const { id } = await insertarAviso(db, fila());
    const d = deps();
    expect(await procesarAvisos(d)).toMatchObject({ enviados: 0, errores: 0 });
    expect(d.enviar).not.toHaveBeenCalled();
    expect((await estado(id)).avisado_at).toBeNull();
  });

  it("reingreso: un mail por aviso, con idempotencyKey, cabeceras de baja y marca avisado_at", async () => {
    await producto("P1", 2, { nombre: "Lámpara Ejemplo" });
    const a = await insertarAviso(db, fila({ email: "a@cliente.example" }));
    const b = await insertarAviso(db, fila({ email: "b@cliente.example" }));
    const d = deps();
    const r = await procesarAvisos(d);
    expect(r).toMatchObject({ omitido: false, revisados: 2, enviados: 2, errores: 0 });
    expect(d.enviar).toHaveBeenCalledTimes(2);
    const llamada = d.enviar.mock.calls.find(([o]) => (o as { to: string }).to === "a@cliente.example")![0] as {
      idempotencyKey: string; subject: string; headers: Record<string, string>; text: string;
    };
    expect(llamada.idempotencyKey).toBe(`aviso-reingreso-${a.id}`);
    expect(llamada.subject).toBe("Ya hay disponible: Lámpara Ejemplo");
    expect(llamada.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(llamada.text).toContain(`https://tienda.example/baja-aviso/${encodeURIComponent(await tokenDe(a.id))}`);
    expect(llamada.text).toContain("https://tienda.example/producto/P1");
    expect((await estado(a.id)).avisado_at).not.toBeNull();
    expect((await estado(b.id)).avisado_at).not.toBeNull();
    // Un segundo barrido no vuelve a enviar.
    const d2 = deps();
    expect(await procesarAvisos(d2)).toMatchObject({ enviados: 0 });
    expect(d2.enviar).not.toHaveBeenCalled();
  });

  it("falla de Resend: avisado_at nulo, email_error cargado; el otro aviso sale igual; el reintento marca y limpia", async () => {
    await producto("P1", 2);
    const mal = await insertarAviso(db, fila({ email: "mal@cliente.example" }));
    const bien = await insertarAviso(db, fila({ email: "bien@cliente.example" }));
    const enviar = vi.fn(async (o: { to: string }) =>
      o.to === "mal@cliente.example" ? { ok: false, error: "No se pudo enviar el email" } : { ok: true, id: "r" },
    );
    const r = await procesarAvisos(deps({ enviar: enviar as never }));
    expect(r).toMatchObject({ enviados: 1, errores: 1 });
    expect(await estado(mal.id)).toMatchObject({ avisado_at: null, email_error: "No se pudo enviar el email", avisando_en: null });
    expect((await estado(bien.id)).avisado_at).not.toBeNull();

    const ok = vi.fn(async () => ({ ok: true, id: "r2" }));
    expect(await procesarAvisos(deps({ enviar: ok as never }))).toMatchObject({ enviados: 1 });
    expect(await estado(mal.id)).toMatchObject({ email_error: null });
    expect((await estado(mal.id)).avisado_at).not.toBeNull();
  });

  it("proveedor sin configurar: no marca y no gasta intentos", async () => {
    await producto("P1", 2);
    const { id } = await insertarAviso(db, fila());
    const enviar = vi.fn(async () => ({ ok: false, error: "Email no configurado", noConfigurado: true }));
    await procesarAvisos(deps({ enviar: enviar as never }));
    expect(await estado(id)).toMatchObject({ avisado_at: null, intentos: 0, email_error: "Email no configurado" });
  });

  it("un aviso dado de baja antes del reingreso no recibe mail", async () => {
    await producto("P1", 2);
    const { id } = await insertarAviso(db, fila());
    await bajaPorToken(db, TENANT, await tokenDe(id));
    const d = deps();
    await procesarAvisos(d);
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("producto oculto en la tienda: no se avisa (el enlace daría 404) y sigue pendiente", async () => {
    await producto("P1", 2, { status: "inactive" });
    const { id } = await insertarAviso(db, fila());
    const d = deps();
    await procesarAvisos(d);
    expect(d.enviar).not.toHaveBeenCalled();
    expect((await estado(id)).avisado_at).toBeNull();
  });

  it("sin URL del sitio no envía nada y lo cuenta como error", async () => {
    await producto("P1", 2);
    await insertarAviso(db, fila());
    const d = deps({ sitio: () => null });
    expect(await procesarAvisos(d)).toMatchObject({ enviados: 0, errores: 1 });
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("no mezcla tenants: solo envía los avisos del propio", async () => {
    await producto("P1", 2);
    await insertarAviso(db, fila({ tenantId: OTRO, email: "otro@cliente.example" }));
    const d = deps();
    await procesarAvisos(d);
    expect(d.enviar).not.toHaveBeenCalled();
  });

  it("respeta el tope de 200 avisos por corrida", async () => {
    await producto("P1", 9);
    const valores = Array.from({ length: 205 }, (_, i) => sql`(${TENANT}, 'P1', ${`u${i}@cliente.example`}, ${`tok-${i}`})`);
    await db.execute(sql`insert into shop.avisos_reingreso (tenant_id, alegra_id, email, token_baja) values ${sql.join(valores, sql`, `)}`);
    const d = deps();
    const r = await procesarAvisos(d);
    expect(r.enviados).toBe(200);
    expect(await pendientesAgrupados(db, TENANT)).toEqual(["P1"]);
  });

  it("la purga corre aunque el flag esté apagado", async () => {
    const { id } = await insertarAviso(db, fila());
    await db.execute(sql`update shop.avisos_reingreso set avisado_at = now() - interval '200 days' where id = ${id}`);
    const r = await procesarAvisos(deps({ activo: async () => false }));
    expect(r).toMatchObject({ omitido: true, purgados: 1 });
  });
});

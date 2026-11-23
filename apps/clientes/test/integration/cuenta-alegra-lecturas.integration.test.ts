import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { escribirEspejo } from "@/lib/contacto-write-through";
import {
  accesoFacturacionEspejo,
  contactoPorDocumento,
  contactoPorId,
  contactosPorEmail,
  facturacionEspejo,
  vinculablePorId,
} from "@/lib/contactos-espejo";
import { listaPrivadaDeContacto } from "@/lib/lista-cuenta-repo";
import { assertLocalTestDb } from "./db-url";

/**
 * Lecturas por cuenta de Alegra del despliegue (change `shop-contactos-alegra-mdp`, S2), contra
 * Postgres REAL (local) con las vistas y la función de write-through del CRM. Datos inventados.
 *
 * El mismo id `123` existe en dos cuentas del tenant y son dos personas: `principal` = Persona A,
 * `mdp` = Persona B. Con `SHOP_CUENTA_ALEGRA=mdp` todo se lee y escribe en la fila de `mdp`; sin la
 * variable, en la de `principal` (comportamiento de siempre).
 */

const TENANT = process.env.SHOP_TENANT_ID!;
let privadaMdp = "";
let privadaPrincipal = "";

async function limpiar() {
  assertLocalTestDb(process.env.DATABASE_URL || "");
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local client_min_messages = warning`);
    await tx.execute(sql`truncate table public.tenants restart identity cascade`);
  });
}

type Fila = Record<string, unknown>;
const q = async (consulta: ReturnType<typeof sql>) => (await getDb().execute(consulta)) as unknown as Fila[];

async function contacto(
  cuenta: string,
  id: string,
  o: { nombre: string; email: string; doc: string; lista: string | null; plazo: number | null },
) {
  await getDb().execute(sql`
    insert into public.alegra_contacts
      (tenant_id, alegra_account, alegra_id, name, identification, identification_norm, email, emails_norm, types,
       price_list_id, payment_term_days, status, raw)
    values (${TENANT}, ${cuenta}, ${id}, ${o.nombre}, ${o.doc}, ${o.doc.replace(/\D/g, "")}, ${o.email},
            ${`{${o.email}}`}::text[], ${"{client}"}::text[], ${o.lista}, ${o.plazo}, 'active',
            ${JSON.stringify({ id, name: o.nombre })}::jsonb)
  `);
}

beforeAll(async () => {
  await limpiar();
  await getDb().execute(
    sql`insert into public.tenants (id, name, logo_path, resend_from) values (${TENANT}, 'Tenant de Test', '/logos/test.svg', 'test@cliente.example')`,
  );
  const [m] = await q(sql`insert into public.listas_precio_online (tenant_id, nombre, coeficiente, privada) values (${TENANT}, 'L5 MDP', 1.25, true) returning id`);
  const [p] = await q(sql`insert into public.listas_precio_online (tenant_id, nombre, coeficiente, privada) values (${TENANT}, 'L5 principal', 1.1, true) returning id`);
  privadaMdp = String(m.id);
  privadaPrincipal = String(p.id);
  // Lista "5" de Alegra enlazada en cada cuenta a una lista online distinta.
  await getDb().execute(sql`
    insert into public.lista_precio_alegra_mapeo (tenant_id, alegra_account, alegra_price_list_id, lista_id)
    values (${TENANT}, 'mdp', '5', ${privadaMdp}), (${TENANT}, 'principal', '5', ${privadaPrincipal})
  `);
  await contacto("principal", "123", { nombre: "Persona A", email: "a@cliente.example", doc: "20-11111111-1", lista: "5", plazo: 30 });
  await contacto("mdp", "123", { nombre: "Persona B", email: "b@cliente.example", doc: "20-22222222-2", lista: "5", plazo: 30 });
  // Sólo en principal.
  await contacto("principal", "200", { nombre: "Persona C", email: "c@cliente.example", doc: "20-33333333-3", lista: "5", plazo: 30 });
  // MDP de contado con la lista enlazada, y MDP corriente con lista sólo enlazada en principal.
  await contacto("mdp", "300", { nombre: "Persona D", email: "d@cliente.example", doc: "20-44444444-4", lista: "5", plazo: 0 });
  await contacto("mdp", "400", { nombre: "Persona E", email: "e@cliente.example", doc: "20-55555555-5", lista: "9", plazo: 30 });
  await getDb().execute(sql`
    insert into public.lista_precio_alegra_mapeo (tenant_id, alegra_account, alegra_price_list_id, lista_id)
    values (${TENANT}, 'principal', '9', ${privadaPrincipal})
  `);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await limpiar();
});

describe("espejo de contactos por cuenta", () => {
  it("default (principal): el 123 es Persona A", async () => {
    expect((await contactoPorId("123"))?.nombre).toBe("Persona A");
    expect((await vinculablePorId("123"))?.name).toBe("Persona A");
    expect((await facturacionEspejo("123"))?.name).toBe("Persona A");
  });

  it("mdp: el 123 es Persona B en todas las lecturas", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    expect((await contactoPorId("123"))?.nombre).toBe("Persona B");
    expect((await vinculablePorId("123"))?.name).toBe("Persona B");
    expect((await facturacionEspejo("123"))?.name).toBe("Persona B");
    expect(await accesoFacturacionEspejo("123")).toBe(true);
    expect((await contactosPorEmail("b@cliente.example")).map((c) => c.name)).toEqual(["Persona B"]);
    expect((await contactoPorDocumento("20222222222"))?.name).toBe("Persona B");
  });

  it("mdp: un email o documento que sólo está en principal no encuentra nada", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    expect(await contactosPorEmail("a@cliente.example")).toEqual([]);
    expect(await contactosPorEmail("c@cliente.example")).toEqual([]);
    expect(await contactoPorDocumento("20-11111111-1")).toBeNull();
    expect(await vinculablePorId("200")).toBeNull();
    expect(await accesoFacturacionEspejo("200")).toBeNull();
  });
});

describe("lista privada por cuenta", () => {
  it("mdp: corriente con lista enlazada en mdp ⇒ la lista de mdp", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    expect(await listaPrivadaDeContacto("123")).toBe(privadaMdp);
  });

  it("mdp: lista enlazada sólo en principal ⇒ precio público; contado ⇒ precio público", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    expect(await listaPrivadaDeContacto("400")).toBeNull();
    expect(await listaPrivadaDeContacto("300")).toBeNull();
  });

  it("default: el mismo 123 usa el enlace de principal", async () => {
    expect(await listaPrivadaDeContacto("123")).toBe(privadaPrincipal);
  });
});

describe("write-through por cuenta", () => {
  it("mdp: completa la fila (mdp, 123) y no toca la de (principal, 123)", async () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    const r = await escribirEspejo("123", { id: "123", name: "Persona B", identification: "20-22222222-2", ivaCondition: "IVA_RESPONSABLE" } as never);
    expect(r).toBe("ok");
    const filas = await q(sql`
      select alegra_account, iva_condition from public.alegra_contacts
      where tenant_id = ${TENANT} and alegra_id = '123' order by alegra_account
    `);
    expect(filas).toEqual([
      { alegra_account: "mdp", iva_condition: "IVA_RESPONSABLE" },
      { alegra_account: "principal", iva_condition: null },
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Backfill del espejo de usuarios de Clerk (change `clientes-tienda-admin`, R1).
 * La Backend API de Clerk es un `fetch` inyectado y la escritura, un callback:
 * nada toca la red ni una base. Datos inventados, dominio `.example`.
 */

// El script importa la lógica de escritura (que importa @/db); acá no se usa.
vi.mock("@/db", () => ({ getDb: () => { throw new Error("sin base en tests"); } }));

import {
  CLERK_USERS_LIMIT,
  clasificar,
  confirmarDestino,
  recorrerUsuariosClerk,
  resumen,
  urlDePagina,
} from "./backfill-clientes-clerk";
import type { UsuarioClerkJSON } from "../src/lib/clientes-espejo";

const usuario = (n: number) => ({
  id: `user_${n}`,
  first_name: `Persona ${n}`,
  last_name: null,
  primary_email_address_id: `idn_${n}`,
  email_addresses: n % 5 === 0 ? [] : [{ id: `idn_${n}`, email_address: `p${n}@cliente.example` }],
  created_at: Date.UTC(2026, 0, 1) + n,
  updated_at: Date.UTC(2026, 0, 2) + n,
}) as unknown as UsuarioClerkJSON;

function paginas(tamanios: number[]) {
  let base = 0;
  return tamanios.map((t) => {
    const p = Array.from({ length: t }, (_, i) => usuario(base + i));
    base += t;
    return p;
  });
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("urlDePagina", () => {
  it("pide 500 por página en orden de alta ascendente", () => {
    expect(CLERK_USERS_LIMIT).toBe(500);
    expect(urlDePagina(1000)).toBe("https://api.clerk.com/v1/users?limit=500&offset=1000&order_by=%2Bcreated_at");
  });
});

describe("recorrerUsuariosClerk", () => {
  const esperar = vi.fn(async () => {});
  beforeEach(() => esperar.mockClear());

  it("pagina 500 / 500 / 12 y entrega cada usuario una vez", async () => {
    const ps = paginas([500, 500, 12]);
    const offsets: number[] = [];
    const vistos: string[] = [];
    const total = await recorrerUsuariosClerk(
      async (offset) => {
        offsets.push(offset);
        return json(ps[offset / 500] ?? []);
      },
      async (u) => {
        vistos.push(u.id);
      },
      { esperar },
    );
    expect(offsets).toEqual([0, 500, 1000]);
    expect(total).toBe(1012);
    expect(new Set(vistos).size).toBe(1012);
  });

  it("una página exacta de 500 pide otra y corta con la vacía", async () => {
    const ps = paginas([500]);
    const offsets: number[] = [];
    await recorrerUsuariosClerk(
      async (offset) => {
        offsets.push(offset);
        return json(ps[offset / 500] ?? []);
      },
      async () => {},
      { esperar },
    );
    expect(offsets).toEqual([0, 500]);
  });

  it("429 ⇒ espera Retry-After y reintenta la MISMA página", async () => {
    const respuestas = [
      new Response("", { status: 429, headers: { "retry-after": "2" } }),
      json(paginas([3])[0]),
    ];
    const offsets: number[] = [];
    const total = await recorrerUsuariosClerk(
      async (offset) => {
        offsets.push(offset);
        return respuestas.shift()!;
      },
      async () => {},
      { esperar },
    );
    expect(offsets).toEqual([0, 0]);
    expect(esperar).toHaveBeenCalledWith(2000);
    expect(total).toBe(3);
  });

  it("más de 3 reintentos por 429 ⇒ corta con error", async () => {
    await expect(
      recorrerUsuariosClerk(
        async () => new Response("", { status: 429, headers: { "retry-after": "1" } }),
        async () => {},
        { esperar },
      ),
    ).rejects.toThrow(/429/);
    expect(esperar).toHaveBeenCalledTimes(3);
  });

  it("otro error HTTP ⇒ corta con el status, sin el cuerpo", async () => {
    await expect(
      recorrerUsuariosClerk(async () => new Response("secreto p1@cliente.example", { status: 401 }), async () => {}, {
        esperar,
      }),
    ).rejects.toThrow(/^Clerk respondió 401$/);
  });
});

describe("clasificar (dry-run)", () => {
  it("cuenta a crear / a actualizar / sin cambios contra lo que ya hay, sin escribir", () => {
    const existentes = new Map([
      ["user_1", { actualizadoEn: new Date(Date.UTC(2026, 0, 2)), eliminado: false }], // más viejo ⇒ actualizar
      ["user_2", { actualizadoEn: new Date(Date.UTC(2030, 0, 1)), eliminado: false }], // más nuevo ⇒ sin cambios
      ["user_3", { actualizadoEn: new Date(Date.UTC(2020, 0, 1)), eliminado: true }], // eliminado ⇒ sin cambios
    ]);
    const c = { crear: 0, actualizar: 0, sinCambios: 0, conEmail: 0, sinEmail: 0 };
    for (const n of [0, 1, 2, 3, 4]) clasificar(usuario(n), existentes, c);
    expect(c).toEqual({ crear: 2, actualizar: 1, sinCambios: 2, conEmail: 4, sinEmail: 1 });
  });
});

describe("resumen", () => {
  it("sólo cantidades: ninguna línea lleva un email", () => {
    const texto = resumen({ leidos: 3, insertado: 1, actualizado: 1, ignorado: 1, eliminado: 0, rechazado: 0 });
    expect(texto).toBe("leídos 3 · insertados 1 · actualizados 1 · ignorados 1 · rechazados 0");
    expect(texto).not.toContain("@");
  });
});

describe("confirmarDestino", () => {
  const base = { SHOP_TENANT_ID: "tenant-x", CLERK_SECRET_KEY: "sk_test_abc" };

  it("base local ⇒ sigue sin confirmación; informa host, tenant e instancia", () => {
    const r = confirmarDestino({ ...base, DATABASE_URL: "postgres://u:clave@localhost:5432/shop_local" });
    expect(r).toEqual({ ok: true, host: "localhost", tenant: "tenant-x", instancia: "test" });
  });

  it("base remota sin BACKFILL_CONFIRM=<host> ⇒ no sigue", () => {
    const r = confirmarDestino({ ...base, DATABASE_URL: "postgres://u:clave@db.plataforma.example/x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("BACKFILL_CONFIRM=db.plataforma.example");
      expect(r.error).not.toContain("clave");
    }
  });

  it("base remota con BACKFILL_CONFIRM del mismo host ⇒ sigue; instancia live por el prefijo", () => {
    const r = confirmarDestino({
      SHOP_TENANT_ID: "tenant-x",
      CLERK_SECRET_KEY: "sk_live_abc",
      DATABASE_URL: "postgres://u:clave@db.plataforma.example/x",
      BACKFILL_CONFIRM: "db.plataforma.example",
    });
    expect(r).toEqual({ ok: true, host: "db.plataforma.example", tenant: "tenant-x", instancia: "live" });
  });

  it.each([
    ["DATABASE_URL", { SHOP_TENANT_ID: "t", CLERK_SECRET_KEY: "sk_test_x" }],
    ["SHOP_TENANT_ID", { DATABASE_URL: "postgres://localhost/x", CLERK_SECRET_KEY: "sk_test_x" }],
    ["CLERK_SECRET_KEY", { DATABASE_URL: "postgres://localhost/x", SHOP_TENANT_ID: "t" }],
  ])("falta %s ⇒ no sigue", (falta, env) => {
    const r = confirmarDestino(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(falta);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";

/**
 * Webhook de Clerk → espejo `shop.clientes` (change `clientes-tienda-admin`, R1).
 * La firma (verifyWebhook) y la base están mockeadas; las funciones SQL se
 * prueban contra Postgres en la suite de integración del admin. Datos
 * inventados, dominio `.example`.
 */

let resultado = "insertado";
function responder(c: ConsultaGrabada): unknown[][] | undefined {
  if (c.sql.includes("shop.clientes_")) return [{ resultado }] as unknown as unknown[][];
  return [];
}
let grabadora = dbGrabadora(responder);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

const verifyWebhook = vi.fn();
vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: (...a: unknown[]) => verifyWebhook(...a),
}));

import { POST } from "./route";

const req = () =>
  new NextRequest("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: { "svix-id": "msg_1", "svix-timestamp": "1", "svix-signature": "v1,x" },
    body: "{}",
  });

const USUARIO = {
  id: "user_abc123",
  first_name: "Ana",
  last_name: "Pérez",
  primary_email_address_id: "idn_1",
  email_addresses: [{ id: "idn_1", email_address: "ana@cliente.example" }],
  created_at: Date.UTC(2026, 8, 1),
  updated_at: Date.UTC(2026, 8, 2),
  // Un tenant en el payload NO se usa nunca.
  public_metadata: { tenant: "tenant-intruso" },
};

const evento = (type: string, data: unknown) => ({ type, object: "event", data });

let logs: string[] = [];

beforeEach(() => {
  grabadora = dbGrabadora(responder);
  resultado = "insertado";
  verifyWebhook.mockReset();
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = "whsec_de_prueba";
  process.env.SHOP_TENANT_ID = "tenant-shop";
  logs = [];
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  // Ningún log del webhook lleva emails (ni de este payload ni de ninguno).
  for (const l of logs) expect(l).not.toContain("@");
});

describe("POST /api/webhooks/clerk", () => {
  it("sin CLERK_WEBHOOK_SIGNING_SECRET ⇒ 500 sin verificar ni escribir", async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    const r = await POST(req());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Webhook no configurado" });
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("firma inválida ⇒ 400 'Firma inválida' sin escribir", async () => {
    verifyWebhook.mockRejectedValue(new Error("No matching signature found"));
    const r = await POST(req());
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Firma inválida" });
    expect(grabadora.consultas).toHaveLength(0);
  });

  it.each(["user.created", "user.updated"])(
    "%s ⇒ 200 recién después de escribir, con el tenant del deploy",
    async (tipo) => {
      verifyWebhook.mockResolvedValue(evento(tipo, USUARIO));
      const r = await POST(req());
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, resultado: "insertado" });
      expect(grabadora.consultas).toHaveLength(1);
      const [c] = grabadora.consultas;
      expect(c.sql).toContain("shop.clientes_upsert_clerk");
      expect(c.params.slice(0, 4)).toEqual(["tenant-shop", "user_abc123", "ana@cliente.example", "Ana Pérez"]);
      expect(c.params).not.toContain("tenant-intruso");
      expect(logs).toContain(`clerk-webhook tipo=${tipo} id=user_abc123 resultado=insertado`);
    },
  );

  it("evento viejo ('ignorado') igual responde 200 para que Clerk no reintente", async () => {
    resultado = "ignorado";
    verifyWebhook.mockResolvedValue(evento("user.updated", USUARIO));
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, resultado: "ignorado" });
  });

  it("user.deleted con id ⇒ baja con el tenant del deploy", async () => {
    resultado = "eliminado";
    verifyWebhook.mockResolvedValue(evento("user.deleted", { object: "user", id: "user_abc123", deleted: true }));
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, resultado: "eliminado" });
    const [c] = grabadora.consultas;
    expect(c.sql).toContain("shop.clientes_eliminar_clerk");
    expect(c.params).toEqual(["tenant-shop", "user_abc123"]);
  });

  it("user.deleted sin id ⇒ 200 sin escribir", async () => {
    verifyWebhook.mockResolvedValue(evento("user.deleted", { object: "user", deleted: true }));
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ignorado: "sin id" });
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("otro tipo (session.created) ⇒ 200 sin escribir", async () => {
    verifyWebhook.mockResolvedValue(evento("session.created", { id: "sess_1", user_id: "user_abc123" }));
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ignorado: "evento" });
    expect(grabadora.consultas).toHaveLength(0);
  });

  it("base caída ⇒ 500 (Clerk reintenta) y el log trae sólo tipo, id y nombre del error", async () => {
    grabadora = dbGrabadora(() => {
      throw new Error("falló la conexión a ana@cliente.example");
    });
    verifyWebhook.mockResolvedValue(evento("user.created", USUARIO));
    const r = await POST(req());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "No se pudo registrar el evento" });
    expect(logs.some((l) => l.startsWith("clerk-webhook tipo=user.created id=user_abc123 error="))).toBe(true);
  });

  it("sin SHOP_TENANT_ID ⇒ 500 sin escribir", async () => {
    delete process.env.SHOP_TENANT_ID;
    verifyWebhook.mockResolvedValue(evento("user.created", USUARIO));
    const r = await POST(req());
    expect(r.status).toBe(500);
    expect(grabadora.consultas).toHaveLength(0);
  });
});

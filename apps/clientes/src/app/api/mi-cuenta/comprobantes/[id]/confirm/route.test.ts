import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Confirm de un comprobante: guard, 503 sin R2, el cliente de la identidad
 * (un id ajeno responde 404 como uno inexistente), `maxDuration` para sharp
 * (sin `runtime`: Node.js es el default y Cache Components no admite
 * declararlo) y el mail con el tenant del Shop. La máquina de estados se
 * prueba en lib/comprobantes/confirmar.test.ts.
 */

const identidad = vi.fn();
/** Cuenta corriente por defecto; `mockResolvedValueOnce(false)` = contado o sin fila en el espejo. */
const acceso = vi.fn(async () => true);
const getR2 = vi.fn();
const confirmar = vi.fn();
const avisar = vi.fn();
const datosTenant = vi.fn();

vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: () => acceso() }));
vi.mock("@/lib/r2", () => ({ getComprobantesR2: () => getR2() }));
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-a" }));
vi.mock("@/lib/cuenta-corriente/tenant-cc", () => ({ datosTenant: () => datosTenant() }));
vi.mock("@/lib/comprobantes/repo", () => ({}));
vi.mock("@/lib/comprobantes/mail", () => ({ enviarAvisoComprobante: (...a: unknown[]) => avisar(...a) }));
vi.mock("@/lib/comprobantes/confirmar", () => ({ confirmarComprobante: (...a: unknown[]) => confirmar(...a) }));

import * as ruta from "./route";
import { POST, maxDuration } from "./route";

const ID = "11111111-2222-4333-8444-555555555555";
const pedir = (id = ID) =>
  POST(new Request(`http://tienda.cliente.example/api/mi-cuenta/comprobantes/${id}/confirm`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  for (const f of [identidad, getR2, confirmar, avisar, datosTenant]) f.mockReset();
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
  getR2.mockReturnValue({});
  datosTenant.mockResolvedValue({
    id: "tenant-a",
    nombre: "Tienda Demo",
    whatsapp: null,
    mailComprobantes: "pagos@tienda.cliente.example",
  });
});

describe("POST /api/mi-cuenta/comprobantes/[id]/confirm", () => {
  it("60 s (sharp nativo + HEIC) y runtime por defecto (Node.js)", () => {
    expect("runtime" in ruta).toBe(false);
    expect(maxDuration).toBe(60);
  });

  it("anónimo 401 / contado 404 / sin R2 503, sin confirmar", async () => {
    identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
    expect((await pedir()).status).toBe(401);
    acceso.mockResolvedValueOnce(false);
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    expect((await pedir()).status).toBe(404);
    identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "42", origen: "vinculacion" } });
    getR2.mockReturnValue(null);
    expect((await pedir()).status).toBe(503);
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("confirma con el cliente de la identidad y avisa con el tenant del Shop", async () => {
    confirmar.mockImplementation(
      async (_e, deps: { avisar: (id: string, b: Uint8Array, d: null) => Promise<unknown> }) => {
        await deps.avisar(ID, new Uint8Array([1]), null);
        return { ok: true, status: "pending" };
      },
    );
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ id: ID, status: "pending" });
    expect(confirmar.mock.calls[0]?.[0]).toEqual({ tenantId: "tenant-a", codigocliente: "42", id: ID });
    expect(avisar.mock.calls[0]?.[0]).toMatchObject({
      tenant: { id: "tenant-a", nombre: "Tienda Demo", mailComprobantes: "pagos@tienda.cliente.example" },
      id: ID,
    });
    // El link del mail nunca sale del request: el aviso no recibe origin.
    expect(avisar.mock.calls[0]?.[0]).not.toHaveProperty("origin");
  });

  it("id ajeno o inexistente ⇒ 404; archivo falso ⇒ 415 con el mensaje de CMP-1", async () => {
    confirmar.mockResolvedValue({ ok: false, status: 404, code: "not_found", error: "No encontramos el comprobante." });
    expect((await pedir()).status).toBe(404);
    confirmar.mockResolvedValue({
      ok: false,
      status: 415,
      code: "unsupported_type",
      error: "El archivo no es un comprobante válido. Suba un PDF o una imagen.",
    });
    const res = await pedir();
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: "El archivo no es un comprobante válido. Suba un PDF o una imagen.",
      code: "unsupported_type",
    });
  });

  it("duplicado ⇒ lo informa sin bloquear", async () => {
    confirmar.mockResolvedValue({
      ok: true,
      status: "pending",
      duplicadoDe: { id: "otro", submittedAt: new Date("2026-09-01T12:00:00.000Z") },
    });
    expect(await (await pedir()).json()).toEqual({
      id: ID,
      status: "pending",
      duplicadoDe: { id: "otro", submittedAt: "2026-09-01T12:00:00.000Z" },
    });
  });

  it("excepción ⇒ 500 en usted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    confirmar.mockRejectedValue(new Error("boom"));
    const res = await pedir();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("No pudimos procesar el comprobante. Inténtelo de nuevo en unos minutos.");
  });
});

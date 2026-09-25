import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, valoresInsertados, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";
import type { DatosLegales } from "@/data/home-defaults";
import type { DatosTenant } from "@/lib/cuenta-corriente/tenant-cc";
import type { EstadoArrepentimiento } from "./arrepentimiento";

/**
 * Server action del Botón de arrepentimiento. Base grabadora, Resend, headers,
 * datos legales y datos del tenant mockeados; `permitir` (rate limit) real, con
 * una IP distinta por test.
 */

const ID = "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10";

let recientes = 0;
let insertFalla = false;
let updateFalla = false;
const responder = (c: ConsultaGrabada) => {
  if (c.sql.startsWith("select")) return [[recientes]];
  if (c.sql.startsWith("insert")) {
    if (insertFalla) throw new Error("conexión caída");
    return [[ID, 42]];
  }
  if (c.sql.startsWith("update") && updateFalla) throw new Error("update caído");
  return [];
};
let grabadora = dbGrabadora(responder);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

const enviarEmail = vi.fn();
vi.mock("@/lib/email", () => ({ enviarEmail: (...a: unknown[]) => enviarEmail(...a) }));

let ip = "10.0.0.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `${ip}, 10.9.9.9` }),
}));

let legal: DatosLegales = {};
vi.mock("@/lib/home-datos", () => ({ getDatosLegales: async () => legal }));

let tenant: DatosTenant | null | Error = null;
vi.mock("@/lib/cuenta-corriente/tenant-cc", () => ({
  datosTenant: async () => {
    if (tenant instanceof Error) throw tenant;
    return tenant;
  },
}));

import { enviarSolicitudArrepentimiento } from "./arrepentimiento-acciones";

const INICIAL: EstadoArrepentimiento = { estado: "inicial" };
let ipSiguiente = 1;

function form(extra: Record<string, string> = {}, haceMs = 5_000): FormData {
  const fd = new FormData();
  const valores = {
    nombre: "Ana Pérez",
    email: "Ana@Cliente.example",
    telefono: "3757 400000",
    pedido: "PED-00001000",
    motivo: "No lo necesito",
    sitio_web: "",
    iniciado: String(Date.now() - haceMs),
    ...extra,
  };
  for (const [k, v] of Object.entries(valores)) fd.set(k, v);
  return fd;
}

const inserts = () => grabadora.consultas.filter((c) => c.sql.startsWith("insert"));
const updates = () => grabadora.consultas.filter((c) => c.sql.startsWith("update"));

beforeEach(() => {
  recientes = 0;
  insertFalla = false;
  updateFalla = false;
  grabadora = dbGrabadora(responder);
  legal = { email: "legal@cliente.example" };
  tenant = { id: "tenant-a", nombre: "Tienda Ejemplo", whatsapp: null, mailComprobantes: "avisos@cliente.example" };
  ip = `10.0.1.${ipSiguiente++}`;
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue({ ok: true, id: "re_1" });
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const GENERICO = "No se pudo registrar la solicitud. Inténtelo de nuevo en unos minutos.";
const DEMASIADAS = "Recibimos demasiadas solicitudes. Inténtelo nuevamente más tarde.";

describe("anti-spam", () => {
  it("honeypot con valor: error genérico, sin insert ni mails", async () => {
    const r = await enviarSolicitudArrepentimiento(INICIAL, form({ sitio_web: "https://spam.example" }));
    expect(r).toMatchObject({ estado: "error", mensaje: GENERICO });
    expect(grabadora.consultas).toEqual([]);
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("enviado 1 s después de pintar el form: error, sin insert", async () => {
    const r = await enviarSolicitudArrepentimiento(INICIAL, form({}, 1_000));
    expect(r).toMatchObject({ estado: "error", mensaje: GENERICO });
    expect(grabadora.consultas).toEqual([]);
  });

  it("6.º envío desde la misma IP: demasiadas solicitudes", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await enviarSolicitudArrepentimiento(INICIAL, form())).estado).toBe("ok");
    }
    grabadora = dbGrabadora(responder);
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toMatchObject({ estado: "error", mensaje: DEMASIADAS });
    expect(inserts()).toEqual([]);
  });

  it("3 solicitudes previas del mismo email (otras mayúsculas): rechaza sin insertar", async () => {
    recientes = 3;
    const r = await enviarSolicitudArrepentimiento(INICIAL, form({ email: "ANA@cliente.EXAMPLE" }));
    expect(r).toMatchObject({ estado: "error", mensaje: DEMASIADAS });
    expect(grabadora.consultas[0].params).toContain("ana@cliente.example");
    expect(inserts()).toEqual([]);
    expect(enviarEmail).not.toHaveBeenCalled();
  });
});

describe("validación", () => {
  it("campos inválidos: errores por campo y valores conservados", async () => {
    const r = await enviarSolicitudArrepentimiento(INICIAL, form({ email: "", telefono: "" }));
    expect(r).toEqual({
      estado: "error",
      errores: { email: "Ingrese su email.", telefono: "Ingrese su teléfono." },
      valores: { nombre: "Ana Pérez", email: "", telefono: "", pedido: "PED-00001000", motivo: "No lo necesito" },
    });
    expect(grabadora.consultas).toEqual([]);
  });
});

describe("envío válido", () => {
  it("guarda, muestra el código y manda los dos mails", async () => {
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toEqual({ estado: "ok", codigo: "ARR-000042", email: "ana@cliente.example", mailCliente: true });

    expect(valoresInsertados(inserts()[0])).toMatchObject({
      tenant_id: "tenant-a",
      email: "ana@cliente.example",
      pedido_numero: "PED-00001000",
    });

    expect(enviarEmail).toHaveBeenCalledTimes(2);
    const [aCliente, aComercio] = enviarEmail.mock.calls.map((c) => c[0]);
    expect(aCliente).toMatchObject({
      to: "ana@cliente.example",
      subject: "Recibimos su solicitud de arrepentimiento ARR-000042",
      idempotencyKey: "ARR-000042-cliente",
    });
    expect(aComercio).toMatchObject({
      to: "legal@cliente.example",
      replyTo: "ana@cliente.example",
      subject: "Nueva solicitud de arrepentimiento ARR-000042",
      idempotencyKey: "ARR-000042-comercio",
    });

    const [u] = updates();
    const [cliente, comercio, error] = u.params;
    expect(cliente).toEqual(expect.any(String));
    expect(comercio).toEqual(expect.any(String));
    expect(error).toBeNull();
  });

  it("pedido y motivo vacíos se guardan como null", async () => {
    const r = await enviarSolicitudArrepentimiento(INICIAL, form({ pedido: "", motivo: "" }));
    expect(r.estado).toBe("ok");
    expect(valoresInsertados(inserts()[0])).toMatchObject({ pedido_numero: null, motivo: null });
  });

  it("Resend falla: el código se muestra igual y queda el error", async () => {
    enviarEmail.mockResolvedValue({ ok: false, error: "No se pudo enviar el email" });
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toEqual({ estado: "ok", codigo: "ARR-000042", email: "ana@cliente.example", mailCliente: false });
    const [cliente, comercio, error] = updates()[0].params;
    expect(cliente).toBeNull();
    expect(comercio).toBeNull();
    expect(error).toContain("No se pudo enviar el email");
  });

  it("enviarEmail lanza: igual devuelve el código", async () => {
    enviarEmail.mockRejectedValue(new Error("boom"));
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toMatchObject({ estado: "ok", codigo: "ARR-000042", mailCliente: false });
    expect(updates()[0].params[2]).toContain("boom");
  });

  it("sin correo legal: el aviso va al mail de comprobantes del tenant", async () => {
    legal = {};
    await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(enviarEmail.mock.calls.map((c) => c[0].to)).toEqual(["ana@cliente.example", "avisos@cliente.example"]);
  });

  it("sin ningún destinatario del comercio: solo el mail al cliente y un warn", async () => {
    legal = {};
    tenant = { id: "tenant-a", nombre: "Tienda Ejemplo", whatsapp: null, mailComprobantes: null };
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toMatchObject({ estado: "ok", mailCliente: true });
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
    const [cliente, comercio, error] = updates()[0].params;
    expect(cliente).toEqual(expect.any(String));
    expect(comercio).toBeNull();
    expect(error).toContain("sin destinatario del comercio");
  });

  it("datosTenant lanza: igual avisa al correo legal", async () => {
    tenant = new Error("public.tenants no disponible");
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toMatchObject({ estado: "ok", mailCliente: true });
    expect(enviarEmail.mock.calls.map((c) => c[0].to)).toEqual(["ana@cliente.example", "legal@cliente.example"]);
  });

  it("marcarEnvios falla: igual devuelve el código", async () => {
    updateFalla = true;
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toMatchObject({ estado: "ok", codigo: "ARR-000042" });
  });
});

describe("fallas de la base", () => {
  it("insert falla: error en usted, sin código, valores conservados, sin mails", async () => {
    insertFalla = true;
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r).toEqual({
      estado: "error",
      mensaje: "No se pudo registrar la solicitud. Inténtelo de nuevo o comuníquese con el comercio.",
      errores: {},
      valores: expect.objectContaining({ nombre: "Ana Pérez", email: "ana@cliente.example" }),
    });
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("sin SHOP_TENANT_ID: error, no lanza", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "");
    const r = await enviarSolicitudArrepentimiento(INICIAL, form());
    expect(r.estado).toBe("error");
    expect(inserts()).toEqual([]);
  });
});

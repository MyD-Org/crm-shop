import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import { CAMPO_TRAMPA, ERRORES } from "./aviso-reingreso-textos";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-test" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

const permitirAsync = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("./rate-limit", () => ({ permitirAsync: (...a: unknown[]) => permitirAsync(...a) }));
vi.mock("./sucursales-datos", () => ({ sucursalesCacheadas: async () => ({ sucursales: [], zonas: [] }) }));

const contarPendientesPorEmail = vi.fn<(...a: unknown[]) => Promise<number>>(async () => 0);
const insertarAviso = vi.fn<(...a: unknown[]) => Promise<{ id: string; creado: boolean }>>(async () => ({ id: "x", creado: true }));
vi.mock("./aviso-reingreso-repo", () => ({
  contarPendientesPorEmail: (...a: unknown[]) => contarPendientesPorEmail(...a),
  insertarAviso: (...a: unknown[]) => insertarAviso(...a),
}));

const elegibleParaAviso = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }));
vi.mock("./aviso-reingreso-elegibilidad", () => ({ elegibleParaAviso: (...a: unknown[]) => elegibleParaAviso(...a) }));

import { solicitarAvisoReingreso } from "./aviso-reingreso-acciones";

const INICIAL = { estado: "inicial" } as const;
const hace = (ms: number) => String(Date.now() - ms);

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    alegraId: "P1",
    email: "Ana@Cliente.example",
    cantidad: "2",
    iniciado: hace(10_000),
    [CAMPO_TRAMPA]: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) f.set(k, v);
  return f;
}

beforeEach(() => {
  setFlag("aviso-reingreso", true);
  permitirAsync.mockReset().mockResolvedValue(true);
  contarPendientesPorEmail.mockReset().mockResolvedValue(0);
  insertarAviso.mockClear();
  elegibleParaAviso.mockReset().mockResolvedValue({ ok: true });
});

describe("solicitarAvisoReingreso", () => {
  it("guarda el aviso con el email normalizado y responde ok", async () => {
    const r = await solicitarAvisoReingreso(INICIAL, form());
    expect(r).toEqual({ estado: "ok", encargar: false });
    expect(insertarAviso).toHaveBeenCalledTimes(1);
    expect(insertarAviso.mock.calls[0][1]).toMatchObject({
      tenantId: "tenant-test",
      alegraId: "P1",
      email: "ana@cliente.example",
      cantidad: 2,
      whatsapp: null,
      quiereEncargar: false,
    });
  });

  it("flag OFF: no guarda nada", async () => {
    setFlag("aviso-reingreso", false);
    const r = await solicitarAvisoReingreso(INICIAL, form());
    expect(r).toMatchObject({ estado: "error", mensaje: ERRORES.noDisponible });
    expect(insertarAviso).not.toHaveBeenCalled();
    expect(elegibleParaAviso).not.toHaveBeenCalled();
  });

  it("honeypot lleno: éxito aparente sin guardar", async () => {
    const r = await solicitarAvisoReingreso(INICIAL, form({ [CAMPO_TRAMPA]: "http://spam.example" }));
    expect(r.estado).toBe("ok");
    expect(insertarAviso).not.toHaveBeenCalled();
    expect(permitirAsync).not.toHaveBeenCalled();
  });

  it("envío demasiado rápido: no guarda", async () => {
    const r = await solicitarAvisoReingreso(INICIAL, form({ iniciado: hace(500) }));
    expect(r.estado).toBe("error");
    expect(insertarAviso).not.toHaveBeenCalled();
  });

  it("email inválido: error por campo en usted y no guarda", async () => {
    const r = await solicitarAvisoReingreso(INICIAL, form({ email: "no-es-un-correo" }));
    expect(r).toEqual({ estado: "error", errores: { email: "Ingrese un correo válido." } });
    expect(insertarAviso).not.toHaveBeenCalled();
  });

  it("rate limit por IP: rechaza con el mensaje acordado", async () => {
    permitirAsync.mockResolvedValue(false);
    const r = await solicitarAvisoReingreso(INICIAL, form());
    expect(r).toMatchObject({ estado: "error", mensaje: "Demasiados intentos. Inténtelo más tarde." });
    expect(insertarAviso).not.toHaveBeenCalled();
    // 5 por hora, por IP.
    expect(permitirAsync).toHaveBeenCalledWith("aviso-reingreso:ip:203.0.113.7", 5, 60 * 60_000);
  });

  it("tope de avisos pendientes por email: no crea más", async () => {
    contarPendientesPorEmail.mockResolvedValue(10);
    const r = await solicitarAvisoReingreso(INICIAL, form());
    expect(r).toMatchObject({ estado: "error", mensaje: ERRORES.topeEmail });
    expect(insertarAviso).not.toHaveBeenCalled();
  });

  it.each(["con_disponible", "no_inventariable", "no_existe", "no_comprable", "a_pedido"])(
    "producto no elegible (%s): se rechaza en el servidor",
    async (motivo) => {
      elegibleParaAviso.mockResolvedValue({ ok: false, motivo });
      const r = await solicitarAvisoReingreso(INICIAL, form());
      expect(r).toMatchObject({ estado: "error", mensaje: ERRORES.noDisponible });
      expect(insertarAviso).not.toHaveBeenCalled();
    },
  );

  it("WhatsApp sin consentimiento no se guarda", async () => {
    await solicitarAvisoReingreso(INICIAL, form({ quiereEncargar: "on", whatsapp: "1155550000" }));
    expect(insertarAviso).not.toHaveBeenCalled();
    await solicitarAvisoReingreso(INICIAL, form({ whatsapp: "1155550000" }));
    expect(insertarAviso.mock.calls[0][1]).toMatchObject({ whatsapp: null, consentimientoContacto: false });
  });

  it("encargar con consentimiento guarda el WhatsApp", async () => {
    const r = await solicitarAvisoReingreso(
      INICIAL,
      form({ quiereEncargar: "on", consentimientoContacto: "on", whatsapp: "1155550000" }),
    );
    expect(r).toEqual({ estado: "ok", encargar: true });
    expect(insertarAviso.mock.calls[0][1]).toMatchObject({ whatsapp: "1155550000", quiereEncargar: true, consentimientoContacto: true });
  });

  it("nunca lanza: una falla de la base termina en un mensaje en usted", async () => {
    insertarAviso.mockRejectedValueOnce(new Error("conexión caída"));
    const r = await solicitarAvisoReingreso(INICIAL, form());
    expect(r).toMatchObject({ estado: "error", mensaje: ERRORES.generico });
  });

  it("no guarda la IP", async () => {
    await solicitarAvisoReingreso(INICIAL, form());
    expect(JSON.stringify(insertarAviso.mock.calls[0][1])).not.toContain("203.0.113.7");
  });
});

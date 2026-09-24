import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactoFacturacion } from "@/lib/contacto-alegra";

/**
 * PUT/PATCH /api/mi-cuenta/facturacion con la lectura única (D-9 de
 * `contacto-fuente-unica`). Se mockean la identidad, el espejo, Alegra y la
 * base del perfil; la lógica de D1 (`contacto-alegra.ts`), la lectura única y
 * el write-through son los reales. Datos inventados.
 */

let identidad: { clerkUserId: string | null; cliente: Record<string, unknown> | null } = {
  clerkUserId: "user_1",
  cliente: null,
};
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: identidad.clerkUserId }) }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => identidad,
  claveSolicitante: async () => (identidad.clerkUserId ? `clerk:${identidad.clerkUserId}` : "crm:42"),
}));
const permitir = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));

let espejo: ContactoFacturacion | null = null;
vi.mock("@/lib/contactos-espejo", () => ({
  CUENTA_ALEGRA_PRINCIPAL: "principal",
  facturacionEspejo: async () => espejo,
}));

const fetchAlegra = vi.fn();
vi.mock("@/lib/alegra", () => ({
  getContacto: async () => null,
  actualizarContacto: (...a: unknown[]) => fetchAlegra(...a),
  actualizarObservacionesContacto: vi.fn(),
}));

const escribirSql = vi.fn();
vi.mock("@/db", () => ({ getDb: () => ({ execute: (...a: unknown[]) => escribirSql(...a) }) }));

let perfil: Record<string, unknown> | null = null;
const upsertRespaldoVinculado = vi.fn();
const actualizarTelefono = vi.fn();
const guardarPerfilFacturacion = vi.fn();
vi.mock("@/lib/facturacion-db", async (orig) => ({
  perfilCompleto: (await orig<typeof import("@/lib/facturacion-db")>()).perfilCompleto,
  getPerfilFacturacion: async () => perfil,
  upsertRespaldoVinculado: (...a: unknown[]) => upsertRespaldoVinculado(...a),
  actualizarTelefono: (...a: unknown[]) => actualizarTelefono(...a),
  guardarPerfilFacturacion: (...a: unknown[]) => guardarPerfilFacturacion(...a),
}));

import { PATCH, PUT } from "./route";

function fila(over: Partial<ContactoFacturacion> = {}): ContactoFacturacion {
  return {
    alegraId: "42",
    name: "ACME SRL",
    identification: "30-71234567-1",
    identificationNorm: "30712345671",
    identificationType: "CUIT",
    identificationNumber: "30-71234567-1",
    ivaCondition: "IVA_RESPONSABLE",
    addressStreet: null,
    addressCity: "Posadas",
    addressProvince: null,
    addressPostalCode: null,
    ...over,
  };
}

const vinculado = { clerkUserId: "user_1", cliente: { codigocliente: "42", cuit: "30-71234567-1", origen: "vinculacion" } };
const soloCookie = { clerkUserId: null, cliente: { codigocliente: "42", origen: "cookie_crm" } };

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/mi-cuenta/facturacion", { method: "PUT", body: JSON.stringify(body) }));
const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/mi-cuenta/facturacion", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  identidad = vinculado;
  espejo = fila();
  perfil = null;
  permitir.mockReset().mockReturnValue(true);
  fetchAlegra.mockReset().mockImplementation(async (id: string, body: object) => ({ id, ...body }));
  escribirSql.mockReset().mockResolvedValue([{ resultado: "ok" }]);
  upsertRespaldoVinculado.mockReset().mockResolvedValue({});
  actualizarTelefono.mockReset().mockImplementation(async (_u: string, t: string) => ({ telefono: t }));
  guardarPerfilFacturacion.mockReset().mockResolvedValue({ id: "p1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("PUT — vinculado (completar vacíos)", () => {
  it("intentar cambiar la razón social ⇒ 409 campo_de_alegra, sin llamar a Alegra", async () => {
    const r = await put({ razonSocial: "Otra SRL", domicilioCalle: "Nueva 1" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: "Ese dato ya figura en su cuenta y no puede modificarse desde la tienda. Si no es correcto, escríbanos.",
      motivo: "campo_de_alegra",
      campos: ["razonSocial"],
    });
    expect(fetchAlegra).not.toHaveBeenCalled();
    expect(upsertRespaldoVinculado).not.toHaveBeenCalled();
  });

  it("calle vacía + razón social igual ⇒ PUT con el cuerpo exacto y write-through", async () => {
    const r = await put({ razonSocial: "ACME SRL", domicilioCalle: "Nueva 1" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "alegra" });
    expect(fetchAlegra).toHaveBeenCalledWith("42", {
      name: "ACME SRL",
      ivaCondition: "IVA_RESPONSABLE",
      identificationObject: { type: "CUIT", number: "30-71234567-1" },
      address: { address: "Nueva 1", city: "Posadas" },
    });
    expect(escribirSql).toHaveBeenCalledTimes(1);
  });

  it("Alegra 400 {code:429}: Clerk ⇒ perfil", async () => {
    fetchAlegra.mockRejectedValue(new Error('Alegra 400 en /contacts/42: {"code":429}'));
    const r = await put({ domicilioCalle: "Nueva 1" });
    expect(await r.json()).toEqual({ estado: "perfil" });
    expect(upsertRespaldoVinculado).toHaveBeenCalledTimes(1);
  });

  it("Alegra 400 {code:429}: sólo cookie ⇒ en_pedido con el complemento", async () => {
    identidad = soloCookie;
    fetchAlegra.mockRejectedValue(new Error('Alegra 400 en /contacts/42: {"code":429}'));
    const r = await put({ domicilioCalle: "Nueva 1" });
    expect(await r.json()).toEqual({ estado: "en_pedido", complemento: { domicilioCalle: "Nueva 1" } });
    expect(upsertRespaldoVinculado).not.toHaveBeenCalled();
  });

  it("condición faltante no enviada ⇒ 400 con errores, sin PUT (R9)", async () => {
    espejo = fila({ ivaCondition: null });
    const r = await put({ domicilioCalle: "Nueva 1" });
    expect(r.status).toBe(400);
    expect((await r.json()).errores).toEqual({ condicionIva: "Elija su condición frente al IVA." });
    expect(fetchAlegra).not.toHaveBeenCalled();
  });

  it("provincia fuera de la lista ⇒ 400", async () => {
    const r = await put({ domicilioCalle: "Nueva 1", domicilioProvincia: "Narnia" });
    expect(r.status).toBe(400);
    expect((await r.json()).errores.domicilioProvincia).toBe("Seleccione una provincia de la lista.");
  });

  it("nada que completar ⇒ 200 sin_cambios, sin PUT", async () => {
    espejo = fila({ addressStreet: "Calle 1", addressProvince: "Misiones", addressPostalCode: "3300" });
    const r = await put({ razonSocial: "ACME SRL" });
    expect(await r.json()).toEqual({ estado: "sin_cambios" });
    expect(fetchAlegra).not.toHaveBeenCalled();
  });

  it("rate limit propio ⇒ 429 en usted", async () => {
    permitir.mockReturnValue(false);
    const r = await put({ domicilioCalle: "Nueva 1" });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("Demasiados intentos. Inténtelo de nuevo en un minuto.");
    expect(permitir).toHaveBeenCalledWith("facturacion:clerk:user_1", 3, 60_000);
  });
});

describe("PUT — no vinculado (perfil, como siempre)", () => {
  it("valida y guarda el perfil; exento con CUIT; provincia con el nombre oficial", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    const r = await put({
      pais: "AR",
      tipoDoc: "CUIT",
      nroDoc: "30-71234567-1",
      razonSocial: "ACME SRL",
      condicionIva: "exento",
      domicilioCalle: "Calle 1",
      domicilioCiudad: "Posadas",
      domicilioProvincia: "caba",
    });
    expect(r.status).toBe(200);
    expect(guardarPerfilFacturacion.mock.calls[0][1]).toMatchObject({
      condicionIva: "exento",
      domicilioProvincia: "Ciudad Autónoma de Buenos Aires",
    });
    expect(fetchAlegra).not.toHaveBeenCalled();
  });

  it("errores en usted", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    const r = await put({ pais: "AR", condicionIva: "exento", tipoDoc: "DNI", nroDoc: "12345678" });
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toBe("Revise los datos de facturación.");
    expect(json.errores.tipoDoc).toMatch(/exige CUIT/);
  });

  it("sin Clerk ni vínculo ⇒ 401", async () => {
    identidad = { clerkUserId: null, cliente: null };
    expect((await put({})).status).toBe(401);
  });
});

describe("PATCH — teléfono", () => {
  it("sin perfil: se guarda igual (fila sólo teléfono) y responde 200", async () => {
    const r = await patch({ telefono: "+54 376 4000000" });
    expect(r.status).toBe(200);
    expect(actualizarTelefono).toHaveBeenCalledWith("user_1", "+54 376 4000000");
  });

  it("sin Clerk ⇒ 401", async () => {
    identidad = soloCookie;
    expect((await patch({ telefono: "+54 376 4000000" })).status).toBe(401);
  });
});

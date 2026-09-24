import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactoFacturacion } from "./contacto-alegra";

/**
 * Lectura única (Dominio 2 de `contacto-fuente-unica`): de dónde salen los
 * datos de facturación según quién compra. Espejo, Alegra y perfil mockeados;
 * datos inventados.
 */

const facturacionEspejo = vi.fn();
vi.mock("./contactos-espejo", () => ({ facturacionEspejo: (id: string) => facturacionEspejo(id) }));
const getContacto = vi.fn();
vi.mock("./alegra", () => ({ getContacto: (id: string) => getContacto(id) }));
let perfil: Record<string, unknown> | null = null;
vi.mock("./facturacion-db", async (orig) => ({
  perfilCompleto: (await orig<typeof import("./facturacion-db")>()).perfilCompleto,
  getPerfilFacturacion: async () => perfil,
}));

import { datosDelContacto, paraElCliente } from "./datos-del-contacto";

const CUIT = "30712345671";

function fila(over: Partial<ContactoFacturacion> = {}): ContactoFacturacion {
  return {
    alegraId: "42",
    name: "ACME SRL",
    identification: "30-71234567-1",
    identificationNorm: CUIT,
    identificationType: "CUIT",
    identificationNumber: "30-71234567-1",
    ivaCondition: "IVA_RESPONSABLE",
    addressStreet: "Calle Falsa 123",
    addressCity: "Posadas",
    addressProvince: null,
    addressPostalCode: null,
    ...over,
  };
}

const PERFIL_COMPLETO = {
  pais: "AR",
  tipoDoc: "CUIT",
  nroDoc: CUIT,
  razonSocial: "ACME SRL",
  condicionIva: "responsable_inscripto",
  domicilioCalle: "Av. Siempreviva 742",
  domicilioCiudad: "Oberá",
  domicilioProvincia: null,
  domicilioCp: null,
  telefono: "3764000000",
  coincideConAlegra: null,
};

const vinculado = (over: Record<string, unknown> = {}) => ({
  clerkUserId: "user_1",
  cliente: { codigocliente: "42", cuit: "30-71234567-1", origen: "vinculacion" as const, ...over },
});
const soloCookie = { clerkUserId: null, cliente: { codigocliente: "42", origen: "cookie_crm" as const } };

beforeEach(() => {
  perfil = null;
  facturacionEspejo.mockReset().mockResolvedValue(fila());
  getContacto.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("datosDelContacto — vinculado", () => {
  it("espejo completo y sin perfil: fuente espejo, completo, sin faltantes, 0 GET", async () => {
    const dc = await datosDelContacto(vinculado());
    expect(dc).toMatchObject({ fuente: "espejo", vinculado: true, completo: true, faltantes: [] });
    expect(dc.datos).toMatchObject({ razonSocial: "ACME SRL", condicionIva: "responsable_inscripto", pais: "AR" });
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("cookie del CRM sin Clerk: espejo, sin mezcla", async () => {
    facturacionEspejo.mockResolvedValue(fila({ addressStreet: null }));
    const dc = await datosDelContacto(soloCookie);
    expect(dc).toMatchObject({ fuente: "espejo", completo: false, faltantes: ["domicilioCalle"], perfil: null });
  });

  it("mismo documento en el perfil: completa la calle ⇒ mixto", async () => {
    facturacionEspejo.mockResolvedValue(fila({ addressStreet: null }));
    perfil = PERFIL_COMPLETO;
    const dc = await datosDelContacto(vinculado());
    expect(dc).toMatchObject({ fuente: "mixto", completo: true });
    expect(dc.datos.domicilioCalle).toBe("Av. Siempreviva 742");
    expect(dc.datos.domicilioCiudad).toBe("Posadas");
  });

  it("perfil con otro documento: se ignora", async () => {
    facturacionEspejo.mockResolvedValue(fila({ addressStreet: null }));
    perfil = { ...PERFIL_COMPLETO, nroDoc: "33693450239" };
    const dc = await datosDelContacto(vinculado());
    expect(dc).toMatchObject({ fuente: "espejo", faltantes: ["domicilioCalle"] });
  });

  it("sin fila en el espejo: 1 GET en vivo con el mismo mapeo ⇒ fuente vivo", async () => {
    facturacionEspejo.mockResolvedValue(null);
    getContacto.mockResolvedValue({
      id: "42",
      name: "ACME SRL",
      identificationObject: { type: "", number: "30-71234567-1" },
      identification: "30-71234567-1",
      ivaCondition: "IVA_EXEMPT",
      address: { address: "Calle Falsa 123", city: "Posadas" },
    });
    const dc = await datosDelContacto(vinculado());
    expect(getContacto).toHaveBeenCalledTimes(1);
    expect(dc).toMatchObject({ fuente: "vivo", completo: true });
    expect(dc.datos).toMatchObject({ condicionIva: "exento", tipoDoc: "CUIT" });
  });

  it("el espejo no responde: va al vivo", async () => {
    facturacionEspejo.mockRejectedValue(Object.assign(new Error("x"), { code: "42501" }));
    getContacto.mockResolvedValue({ id: "42", name: "ACME SRL" });
    const dc = await datosDelContacto(vinculado());
    expect(dc.fuente).toBe("vivo");
    expect(dc.faltantes).toEqual(["tipoDoc", "nroDoc", "condicionIva", "domicilioCalle", "domicilioCiudad"]);
  });

  it("404 en vivo: contacto vacío (todo faltante), mezcla con el perfil del mismo CUIT del vínculo", async () => {
    facturacionEspejo.mockResolvedValue(null);
    getContacto.mockRejectedValue(new Error("Alegra 404 en /contacts/42: {}"));
    perfil = PERFIL_COMPLETO;
    const dc = await datosDelContacto(vinculado());
    expect(dc.fuente).toBe("mixto");
    expect(dc.faltantes).toEqual(["tipoDoc", "nroDoc"]);
  });

  it("Alegra no responde (429 disfrazado): perfil del mismo documento ⇒ perfil; si no ⇒ no_disponible", async () => {
    facturacionEspejo.mockResolvedValue(null);
    getContacto.mockRejectedValue(new Error('Alegra 400 en /contacts/42: {"code":429}'));
    const sinPerfil = await datosDelContacto(vinculado());
    expect(sinPerfil).toMatchObject({ fuente: "no_disponible", completo: false });

    perfil = PERFIL_COMPLETO;
    const conPerfil = await datosDelContacto(vinculado());
    expect(conPerfil).toMatchObject({ fuente: "perfil", completo: true });
    expect(conPerfil.datos.razonSocial).toBe("ACME SRL");
    const logs = vi.mocked(console.error).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logs).toContain("(400)");
    expect(logs).not.toContain("429}");
  });

  it("documento incompatible: completo y con motivo", async () => {
    facturacionEspejo.mockResolvedValue(fila({ identificationType: "DNI", identificationNumber: "12345678" }));
    const dc = await datosDelContacto(vinculado());
    expect(dc).toMatchObject({ completo: true, motivoRevision: "documento_incompatible" });
  });

  it("paraElCliente no expone lo interno ni el perfil", async () => {
    const pub = paraElCliente(await datosDelContacto(vinculado()));
    expect(pub).not.toHaveProperty("interno");
    expect(pub).not.toHaveProperty("perfil");
  });
});

describe("datosDelContacto — no vinculado", () => {
  const noVinculado = { clerkUserId: "user_1", cliente: null };

  it("sin perfil: ninguna, todos los requeridos faltan", async () => {
    const dc = await datosDelContacto(noVinculado);
    expect(dc).toMatchObject({ fuente: "ninguna", completo: false, vinculado: false });
    expect(dc.faltantes).toHaveLength(6);
    expect(facturacionEspejo).not.toHaveBeenCalled();
  });

  it("con perfil completo: perfil, completo (como hoy)", async () => {
    perfil = PERFIL_COMPLETO;
    expect(await datosDelContacto(noVinculado)).toMatchObject({ fuente: "perfil", completo: true, faltantes: [] });
  });

  it("fila sólo teléfono: ninguna", async () => {
    perfil = { pais: "AR", tipoDoc: null, nroDoc: null, razonSocial: null, condicionIva: null, telefono: "3764000000" };
    expect(await datosDelContacto(noVinculado)).toMatchObject({ fuente: "ninguna", completo: false });
  });

  it("perfil sin calle: faltante sólo la calle", async () => {
    perfil = { ...PERFIL_COMPLETO, domicilioCalle: null };
    expect((await datosDelContacto(noVinculado)).faltantes).toEqual(["domicilioCalle"]);
  });
});

describe("datosDelContacto — teléfono desde el espejo (0036 del CRM)", () => {
  it("vinculado: teléfonos del espejo y el preferido (celular > principal > secundario)", async () => {
    facturacionEspejo.mockResolvedValue(fila({ phonePrimary: "011 4000-0000", mobile: "11 5000-0000" }));
    const dc = await datosDelContacto(vinculado());
    expect(dc.telefonos).toEqual({ mobile: "11 5000-0000", phonePrimary: "011 4000-0000", phoneSecondary: null });
    expect(dc.telefonoAlegra).toBe("11 5000-0000");
    // Va al navegador (es el teléfono del propio comprador).
    expect(paraElCliente(dc).telefonoAlegra).toBe("11 5000-0000");
  });

  it("vinculado sin teléfonos en el espejo: null (se pide en el checkout), aunque el perfil tenga uno", async () => {
    perfil = PERFIL_COMPLETO;
    const dc = await datosDelContacto(vinculado());
    expect(dc.telefonoAlegra).toBeNull();
    expect(dc.perfil?.telefono).toBe("3764000000");
  });

  it("vinculado leído en vivo: mismo mapeo de teléfonos", async () => {
    facturacionEspejo.mockResolvedValue(null);
    getContacto.mockResolvedValue({ id: "42", name: "ACME SRL", phoneSecondary: "011 4000-0001" });
    const dc = await datosDelContacto(vinculado());
    expect(dc.fuente).toBe("vivo");
    expect(dc.telefonoAlegra).toBe("011 4000-0001");
  });

  it("no vinculado: nunca teléfono de Alegra (sigue el del perfil)", async () => {
    perfil = PERFIL_COMPLETO;
    const dc = await datosDelContacto({ clerkUserId: "user_1", cliente: null });
    expect(dc.telefonos).toBeNull();
    expect(dc.telefonoAlegra).toBeNull();
  });

  it("Alegra no disponible: sin teléfono de Alegra", async () => {
    facturacionEspejo.mockResolvedValue(null);
    getContacto.mockRejectedValue(new Error("Alegra 503 en /contacts/42"));
    const dc = await datosDelContacto(vinculado());
    expect(dc.telefonoAlegra).toBeNull();
  });
});

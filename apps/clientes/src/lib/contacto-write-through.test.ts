import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbGrabadora, type ConsultaGrabada } from "@/db/__fixtures__/db-grabadora";
import { leerContacto, validarComplemento, type ContactoFacturacion } from "./contacto-alegra";

/**
 * Write-through del contacto (Dominio 5 y 8 de `contacto-fuente-unica`): PUT a
 * Alegra sólo con vacíos, espejo al día por la función del CRM y respaldo si
 * Alegra falla. Alegra y el perfil mockeados; la base es una grabadora de SQL.
 * Datos inventados.
 */

let resultadoFuncion = "ok";
function responder(c: ConsultaGrabada): unknown[][] | undefined {
  // `execute` de pg-proxy devuelve las filas tal cual: objetos, como postgres.js.
  if (c.sql.includes("shop_contacto_write_through")) return [{ resultado: resultadoFuncion }] as unknown as unknown[][];
  return [];
}
let grabadora = dbGrabadora(responder);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

const actualizarContacto = vi.fn();
const actualizarObservacionesContacto = vi.fn();
const actualizarContactoTalCual = vi.fn();
const getContacto = vi.fn();
vi.mock("./alegra", () => ({
  actualizarContacto: (...a: unknown[]) => actualizarContacto(...a),
  actualizarObservacionesContacto: (...a: unknown[]) => actualizarObservacionesContacto(...a),
  actualizarContactoTalCual: (...a: unknown[]) => actualizarContactoTalCual(...a),
  getContacto: (id: string) => getContacto(id),
}));
const upsertRespaldoVinculado = vi.fn();
let perfil: Record<string, unknown> | null = null;
vi.mock("./facturacion-db", () => ({
  getPerfilFacturacion: async () => perfil,
  upsertRespaldoVinculado: (...a: unknown[]) => upsertRespaldoVinculado(...a),
}));

import { completarEnAlegra, escribirEspejo, sincronizarContactoConPerfil } from "./contacto-write-through";

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

const CONTACTO_ALEGRA = {
  id: "42",
  name: "ACME SRL",
  identification: "30-71234567-1",
  identificationObject: { type: "CUIT", number: "30-71234567-1" },
  ivaCondition: "IVA_RESPONSABLE",
  address: { address: "", city: "Posadas" },
  email: "compras@cliente.example",
  observations: "Paga con cheque.",
};

const llamadasFuncion = () => grabadora.consultas.filter((c) => c.sql.includes("shop_contacto_write_through"));

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  resultadoFuncion = "ok";
  grabadora = dbGrabadora(responder);
  perfil = null;
  actualizarContacto.mockReset().mockImplementation(async (id: string, body: object) => ({ id, ...body }));
  actualizarObservacionesContacto.mockReset().mockResolvedValue({ id: "42" });
  actualizarContactoTalCual
    .mockReset()
    .mockImplementation(async (c: { id: string; name: string }, extra: object) => ({ id: c.id, name: c.name, ...extra }));
  getContacto.mockReset().mockResolvedValue(CONTACTO_ALEGRA);
  upsertRespaldoVinculado.mockReset().mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function completar(clerkUserId: string | null = "user_1") {
  const base = fila();
  const r = validarComplemento(leerContacto(base), { domicilioCalle: "Nueva 1", razonSocial: "ACME SRL" });
  if (!r.ok) throw new Error("debería validar");
  return completarEnAlegra({ alegraId: "42", base, datos: r.datos, complemento: r.complemento, clerkUserId });
}

describe("escribirEspejo", () => {
  it("llama la función del CRM con tenant, cuenta principal, id y el contacto como texto → jsonb", async () => {
    expect(await escribirEspejo("42", { id: "42", name: "ACME SRL" })).toBe("ok");
    const [llamada] = llamadasFuncion();
    expect(llamada.sql).toMatch(/public\.shop_contacto_write_through\(\$1, \$2, \$3, \$4::text::jsonb\)/);
    expect(llamada.params.slice(0, 3)).toEqual(["tenant-test", "principal", "42"]);
    expect(JSON.parse(llamada.params[3] as string)).toEqual({ id: "42", name: "ACME SRL" });
  });

  it("'sin_fila' / 'rechazado' sólo se registran", async () => {
    resultadoFuncion = "rechazado";
    expect(await escribirEspejo("42", { id: "42", name: "X" })).toBe("rechazado");
    expect(vi.mocked(console.warn).mock.calls.join(" ")).toContain("contacto 42: rechazado");
  });
});

describe("completarEnAlegra", () => {
  it("PUT con el cuerpo exacto (sólo vacíos) y write-through con la respuesta", async () => {
    expect(await completar()).toEqual({ estado: "alegra" });
    expect(actualizarContacto).toHaveBeenCalledWith("42", {
      name: "ACME SRL",
      ivaCondition: "IVA_RESPONSABLE",
      identificationObject: { type: "CUIT", number: "30-71234567-1" },
      address: { address: "Nueva 1", city: "Posadas" },
    });
    expect(llamadasFuncion()).toHaveLength(1);
    expect(upsertRespaldoVinculado).not.toHaveBeenCalled();
  });

  it("Alegra 400 {code:429} con Clerk ⇒ respaldo en el perfil con el documento del espejo", async () => {
    actualizarContacto.mockRejectedValue(new Error('Alegra 400 en /contacts/42: {"code":429}'));
    expect(await completar()).toEqual({ estado: "perfil" });
    expect(upsertRespaldoVinculado).toHaveBeenCalledWith("user_1", {
      tipoDoc: "CUIT",
      nroDoc: "30-71234567-1",
      razonSocial: "ACME SRL",
      complemento: { domicilioCalle: "Nueva 1" },
    });
    expect(llamadasFuncion()).toHaveLength(0);
    const log = vi.mocked(console.error).mock.calls.join(" ");
    expect(log).toContain("contacto 42");
    expect(log).toContain("(400)");
    expect(log).not.toContain("Nueva 1");
  });

  it("timeout con la cookie del CRM ⇒ en_pedido con el complemento, sin perfil", async () => {
    actualizarContacto.mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    expect(await completar(null)).toEqual({ estado: "en_pedido", complemento: { domicilioCalle: "Nueva 1" } });
    expect(upsertRespaldoVinculado).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.join(" ")).toContain("(timeout)");
  });
});

describe("sincronizarContactoConPerfil (vinculación y pedido mixto)", () => {
  const PERFIL = {
    pais: "AR",
    tipoDoc: "CUIT",
    nroDoc: "30712345671",
    razonSocial: "Otra razón",
    condicionIva: "consumidor_final",
    domicilioCalle: "Av. Siempreviva 742",
    domicilioCiudad: "Oberá",
    domicilioProvincia: "misiones",
    domicilioCp: null,
  };

  it("mismo documento: UN PUT con la calle y la provincia (oficial), sin tocar razón social ni condición", async () => {
    perfil = PERFIL;
    await sincronizarContactoConPerfil("42", { clerkUserId: "user_1" });
    expect(getContacto).toHaveBeenCalledTimes(1);
    expect(actualizarContacto).toHaveBeenCalledTimes(1);
    expect(actualizarContacto).toHaveBeenCalledWith("42", {
      name: "ACME SRL",
      ivaCondition: "IVA_RESPONSABLE",
      identificationObject: { type: "CUIT", number: "30-71234567-1" },
      address: { address: "Av. Siempreviva 742", city: "Posadas", province: "Misiones" },
    });
    expect(llamadasFuncion()).toHaveLength(1);
  });

  it("mismo documento + email alternativo: el mismo PUT lleva las observaciones", async () => {
    perfil = PERFIL;
    await sincronizarContactoConPerfil("42", { clerkUserId: "user_1", emailAlternativo: "otro@cliente.example" });
    expect(actualizarContacto).toHaveBeenCalledTimes(1);
    expect(actualizarContacto.mock.calls[0][1].observations).toMatch(/^Paga con cheque\.\nTienda online: también usa otro@cliente\.example/);
    expect(actualizarObservacionesContacto).not.toHaveBeenCalled();
  });

  it("otro documento: sólo observaciones (PUT de siempre) o nada", async () => {
    perfil = { ...PERFIL, nroDoc: "33693450239" };
    await sincronizarContactoConPerfil("42", { clerkUserId: "user_1", emailAlternativo: "otro@cliente.example" });
    expect(actualizarContacto).not.toHaveBeenCalled();
    expect(actualizarObservacionesContacto).toHaveBeenCalledTimes(1);

    actualizarObservacionesContacto.mockClear();
    await sincronizarContactoConPerfil("42", { clerkUserId: "user_1" });
    expect(actualizarContacto).not.toHaveBeenCalled();
    expect(actualizarObservacionesContacto).not.toHaveBeenCalled();
  });

  it("nada que aportar (Alegra completo): sin PUT", async () => {
    getContacto.mockResolvedValue({ ...CONTACTO_ALEGRA, address: { address: "Calle 1", city: "Posadas", province: "Misiones", postalCode: "3300" } });
    perfil = PERFIL;
    await sincronizarContactoConPerfil("42", { clerkUserId: "user_1" });
    expect(actualizarContacto).not.toHaveBeenCalled();
  });

  it("Alegra 429: se registra y no lanza", async () => {
    perfil = PERFIL;
    actualizarContacto.mockRejectedValue(new Error('Alegra 400 en /contacts/42: {"code":429}'));
    await expect(sincronizarContactoConPerfil("42", { clerkUserId: "user_1" })).resolves.toBeUndefined();
    expect(vi.mocked(console.error).mock.calls.join(" ")).toContain("contacto 42");
  });
});

describe("sincronizarContactoConPerfil con el teléfono del pedido (sólo completar vacíos)", () => {
  it("Alegra sin ningún teléfono ⇒ UN PUT tal cual + phonePrimary, y write-through con la respuesta", async () => {
    await sincronizarContactoConPerfil("42", { clerkUserId: null, telefono: "  +54 376 4000000 " });
    expect(actualizarContactoTalCual).toHaveBeenCalledTimes(1);
    const [contacto, extra] = actualizarContactoTalCual.mock.calls[0];
    expect(contacto).toMatchObject({ id: "42", name: "ACME SRL", ivaCondition: "IVA_RESPONSABLE" });
    expect(extra).toEqual({ phonePrimary: "+54 376 4000000" });
    expect(actualizarContacto).not.toHaveBeenCalled();
    expect(actualizarObservacionesContacto).not.toHaveBeenCalled();
    expect(llamadasFuncion()).toHaveLength(1);
  });

  it.each([
    ["celular", { mobile: "11 5000-0000" }],
    ["principal", { phonePrimary: "011 4000-0000" }],
    ["secundario", { phoneSecondary: "011 4000-0001" }],
  ])("el contacto FRESCO ya tiene %s (el espejo estaba atrasado) ⇒ no se escribe nada", async (_, tel) => {
    getContacto.mockResolvedValue({ ...CONTACTO_ALEGRA, ...tel });
    await sincronizarContactoConPerfil("42", { clerkUserId: null, telefono: "+54 376 4000000" });
    expect(actualizarContactoTalCual).not.toHaveBeenCalled();
    expect(actualizarContacto).not.toHaveBeenCalled();
    expect(actualizarObservacionesContacto).not.toHaveBeenCalled();
  });

  it("teléfono inválido ⇒ no se escribe", async () => {
    await sincronizarContactoConPerfil("42", { clerkUserId: null, telefono: "123" });
    expect(actualizarContactoTalCual).not.toHaveBeenCalled();
  });

  it("teléfono + email alternativo ⇒ el mismo PUT lleva los dos", async () => {
    await sincronizarContactoConPerfil("42", {
      clerkUserId: null,
      telefono: "+54 376 4000000",
      emailAlternativo: "otro@cliente.example",
    });
    expect(actualizarContactoTalCual).toHaveBeenCalledTimes(1);
    const extra = actualizarContactoTalCual.mock.calls[0][1];
    expect(extra.phonePrimary).toBe("+54 376 4000000");
    expect(extra.observations).toMatch(/Tienda online: también usa otro@cliente\.example/);
  });

  it("teléfono + vacíos del perfil (mismo documento) ⇒ UN PUT sólo-vacíos con phonePrimary", async () => {
    perfil = {
      pais: "AR",
      tipoDoc: "CUIT",
      nroDoc: "30712345671",
      razonSocial: "ACME SRL",
      condicionIva: "responsable_inscripto",
      domicilioCalle: "Av. Siempreviva 742",
      domicilioCiudad: "Posadas",
      domicilioProvincia: null,
      domicilioCp: null,
    };
    await sincronizarContactoConPerfil("42", { clerkUserId: "user_1", telefono: "+54 376 4000000" });
    expect(actualizarContacto).toHaveBeenCalledTimes(1);
    expect(actualizarContacto.mock.calls[0][1]).toMatchObject({
      address: { address: "Av. Siempreviva 742", city: "Posadas" },
      phonePrimary: "+54 376 4000000",
    });
    expect(actualizarContactoTalCual).not.toHaveBeenCalled();
  });
});

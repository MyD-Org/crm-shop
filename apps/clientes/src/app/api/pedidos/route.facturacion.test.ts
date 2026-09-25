import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactoFacturacion } from "@/lib/contacto-alegra";

/**
 * POST /api/pedidos con la lectura única de facturación (Dominio 4 de
 * `contacto-fuente-unica`). La lectura (`datosDelContacto`) y las reglas de D1
 * son las reales; se mockean la identidad, el espejo, Alegra, el perfil, la
 * cotización y la persistencia del pedido. Datos inventados.
 */

let identidad: { clerkUserId: string | null; cliente: Record<string, unknown> | null; email?: string } = {
  clerkUserId: "user_1",
  cliente: null,
};
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => identidad,
  idPriceListCliente: async () => undefined,
}));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: async () => ({ lineas: [{ id: "1", qty: 1 }], hayProblemas: false, subtotal: 1000, iva: 210, costoEnvio: 0, total: 1210 }),
}));
const crearPedido = vi.fn();
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/pagos-flag", () => ({ pagosHabilitados: () => false }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => false }));

let espejo: ContactoFacturacion | null = null;
/** Contacto de Alegra con el documento del perfil (no vinculado), por id. */
let coincidente: { id: string; priceList: { id: string; name: string; status?: string } | null } | null = null;
let listaGeneral: string | null = "1";
const vinculablePorId = vi.fn();
vi.mock("@/lib/contactos-espejo", () => ({
  CUENTA_ALEGRA_PRINCIPAL: "principal",
  facturacionEspejo: async () => espejo,
  vinculablePorId: (id: string) => vinculablePorId(id),
  idListaGeneral: async () => listaGeneral,
}));
const getContacto = vi.fn();
vi.mock("@/lib/alegra", async (orig) => ({
  ...(await orig<typeof import("@/lib/alegra")>()),
  getContacto: (id: string) => getContacto(id),
  actualizarContacto: vi.fn(),
  actualizarObservacionesContacto: vi.fn(),
}));

let perfil: Record<string, unknown> | null = null;
const guardarTelefonoSiFalta = vi.fn();
vi.mock("@/lib/facturacion-db", async (orig) => ({
  perfilCompleto: (await orig<typeof import("@/lib/facturacion-db")>()).perfilCompleto,
  getPerfilFacturacion: async () => perfil,
  guardarTelefonoSiFalta: (...a: unknown[]) => guardarTelefonoSiFalta(...a),
  upsertRespaldoVinculado: vi.fn(),
}));

const sincronizar = vi.fn();
vi.mock("@/lib/contacto-write-through", () => ({
  sincronizarContactoConPerfil: (...a: unknown[]) => sincronizar(...a),
}));
// La última tarea de after() es siempre el mail "Recibimos su pedido" (pedido nuevo).
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoRecibido: vi.fn() }));
let tareasAfter: Array<() => unknown> = [];
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    tareasAfter.push(fn);
  },
}));

import { POST } from "./route";

function fila(over: Partial<ContactoFacturacion> = {}): ContactoFacturacion {
  return {
    alegraId: "42",
    name: "ACME SRL",
    identification: "30-71234567-1",
    identificationNorm: "30712345671",
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

const PERFIL = {
  pais: "AR",
  tipoDoc: "DNI",
  nroDoc: "12345678",
  razonSocial: "Ana Pérez",
  condicionIva: "consumidor_final",
  domicilioCalle: "Calle 1",
  domicilioCiudad: "Posadas",
  domicilioProvincia: null,
  domicilioCp: null,
  telefono: null,
  coincideConAlegra: null,
};

const vinculado = { clerkUserId: "user_1", cliente: { codigocliente: "42", cuit: "30-71234567-1", origen: "vinculacion" } };
const soloCookie = { clerkUserId: null, cliente: { codigocliente: "42", origen: "cookie_crm" } };

const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: "1", qty: 1 }],
        contactoNombre: "Ana",
        contactoTelefono: "+54 376 4000000",
        entregaTipo: "retiro",
        pagoMetodo: "a_coordinar",
        ...extra,
      }),
    }),
  );

const datosDelPedido = () => crearPedido.mock.calls[0][1];

beforeEach(() => {
  identidad = vinculado;
  espejo = fila();
  perfil = null;
  coincidente = null;
  listaGeneral = "1";
  vinculablePorId.mockReset().mockImplementation(async () => coincidente);
  tareasAfter = [];
  sincronizar.mockReset();
  getContacto.mockReset().mockResolvedValue(null);
  guardarTelefonoSiFalta.mockReset().mockResolvedValue(undefined);
  crearPedido.mockReset().mockResolvedValue({ id: "p1", numero: "PED-1", repetido: false, cuotasMax: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/pedidos — facturación desde la lectura única", () => {
  it("vinculado SIN perfil y espejo completo ⇒ 201 con la facturación del espejo (antes: 409)", async () => {
    const r = await post();
    expect(r.status).toBe(201);
    expect(datosDelPedido()).toMatchObject({
      facturacion: {
        tipoDoc: "CUIT",
        nroDoc: "30712345671",
        razonSocial: "ACME SRL",
        condicionIva: "responsable_inscripto",
        domicilio: "Calle Falsa 123, Posadas",
      },
      requiereRevision: false,
    });
    // Sin perfil igual aprende el teléfono (fila sólo teléfono).
    expect(guardarTelefonoSiFalta).toHaveBeenCalledWith("user_1", "+54 376 4000000");
  });

  it("espejo incompleto ⇒ 409 facturacion_incompleta con los faltantes, en usted", async () => {
    espejo = fila({ addressStreet: null });
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: "Cargue sus datos de facturación para continuar.",
      motivo: "facturacion_incompleta",
      faltantes: ["domicilioCalle"],
    });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("cookie del CRM sin Clerk, espejo completo ⇒ 201 (D4)", async () => {
    identidad = soloCookie;
    expect((await post()).status).toBe(201);
    expect(guardarTelefonoSiFalta).not.toHaveBeenCalled();
  });

  it("cookie + complemento (el PUT a Alegra falló) ⇒ 201, para revisión, con la calle en el domicilio", async () => {
    identidad = soloCookie;
    espejo = fila({ addressStreet: null });
    const r = await post({ complementoFacturacion: { domicilioCalle: "Nueva 1" } });
    expect(r.status).toBe(201);
    expect(datosDelPedido()).toMatchObject({
      facturacion: { domicilio: "Nueva 1, Posadas" },
      requiereRevision: true,
      motivoRevision: "facturacion_en_pedido",
    });
  });

  it("complemento que intenta pisar un dato de Alegra ⇒ 409, sin pedido", async () => {
    identidad = soloCookie;
    espejo = fila({ addressStreet: null });
    const r = await post({ complementoFacturacion: { domicilioCalle: "Nueva 1", razonSocial: "Otra SRL" } });
    expect(r.status).toBe(409);
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("exento se congela tal cual", async () => {
    espejo = fila({ ivaCondition: "IVA_EXEMPT" });
    await post();
    expect(datosDelPedido().facturacion.condicionIva).toBe("exento");
  });

  it("RI con 12 dígitos y RI con DNI ⇒ 201 y para revisión (no bloquea)", async () => {
    espejo = fila({ identificationType: null, identificationNumber: "201234567861", identification: "201234567861", identificationNorm: "201234567861" });
    expect((await post()).status).toBe(201);
    expect(datosDelPedido().requiereRevision).toBe(true);

    crearPedido.mockClear();
    espejo = fila({ identificationType: "DNI", identificationNumber: "12345678", identification: "12345678", identificationNorm: "12345678" });
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({
      requiereRevision: true,
      motivoRevision: "documento_incompatible",
      facturacion: { tipoDoc: "DNI", nroDoc: "12345678" },
    });
    expect(vi.mocked(console.warn).mock.calls.join(" ")).toContain("pedido p1 para revisión: documento_incompatible");
  });

  it("no vinculado sin perfil ⇒ 409; con perfil ⇒ como siempre", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    expect((await post()).status).toBe(409);

    perfil = { ...PERFIL, coincideConAlegra: "77" };
    coincidente = { id: "77", priceList: null };
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({
      facturacion: { tipoDoc: "DNI", nroDoc: "12345678", razonSocial: "Ana Pérez", condicionIva: "consumidor_final" },
      // Coincide con un contacto de Alegra sin lista propia: comprar a la
      // general está bien, no hay nada que revisar.
      requiereRevision: false,
      motivoRevision: null,
    });
    expect(vinculablePorId).toHaveBeenCalledWith("77");
  });

  it("vinculado monotributo con DNI (caso 2026-09-24) ⇒ documento_incompatible persistido y logueado sin datos", async () => {
    espejo = fila({
      ivaCondition: "UNIQUE_TRIBUTE_RESPONSABLE",
      identificationType: "DNI",
      identificationNumber: "12345678",
      identification: "12345678",
      identificationNorm: "12345678",
    });
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({ requiereRevision: true, motivoRevision: "documento_incompatible" });
    // Vinculado: la regla de la lista no se consulta.
    expect(vinculablePorId).not.toHaveBeenCalled();
    const log = vi.mocked(console.warn).mock.calls.join(" ");
    expect(log).toContain("pedido p1 para revisión: documento_incompatible");
    expect(log).not.toContain("12345678");
  });

  it("vinculado completo ⇒ sin revisión (requiereRevision false, motivo null)", async () => {
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({ requiereRevision: false, motivoRevision: null });
  });

  it("no vinculado: contacto coincidente con la MISMA lista que la general ⇒ sin revisión", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    perfil = { ...PERFIL, coincideConAlegra: "77" };
    coincidente = { id: "77", priceList: { id: "1", name: "General", status: "active" } };
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({ requiereRevision: false, motivoRevision: null });
  });

  it("no vinculado: contacto coincidente con OTRA lista ⇒ otra_lista_precios", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    perfil = { ...PERFIL, coincideConAlegra: "77" };
    coincidente = { id: "77", priceList: { id: "5", name: "Mayorista", status: "active" } };
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({ requiereRevision: true, motivoRevision: "otra_lista_precios" });
    expect(vi.mocked(console.warn).mock.calls.join(" ")).toContain("pedido p1 para revisión: otra_lista_precios");
  });

  it("no vinculado: la lista del contacto está dada de baja ⇒ cuenta como la general, sin revisión", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    perfil = { ...PERFIL, coincideConAlegra: "77" };
    coincidente = { id: "77", priceList: { id: "5", name: "NO USAR", status: "inactive" } };
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({ requiereRevision: false, motivoRevision: null });
  });

  it("no vinculado: el espejo no responde ⇒ el pedido sale igual, sin revisión", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    perfil = { ...PERFIL, coincideConAlegra: "77" };
    vinculablePorId.mockRejectedValue(Object.assign(new Error("x"), { code: "57P01" }));
    expect((await post()).status).toBe(201);
    expect(datosDelPedido()).toMatchObject({ requiereRevision: false, motivoRevision: null });
  });

  it("mixto (algo quedó en el perfil) ⇒ se programa la subida en after(), sin esperarla", async () => {
    espejo = fila({ addressStreet: null });
    perfil = { ...PERFIL, tipoDoc: "CUIT", nroDoc: "30712345671", domicilioCalle: "Av. Siempreviva 742" };
    const r = await post();
    expect(r.status).toBe(201);
    expect(sincronizar).not.toHaveBeenCalled();
    expect(tareasAfter).toHaveLength(2);
    await tareasAfter[0]();
    // Una sola subida: lo del perfil y, como Alegra no tiene teléfono, el tipeado.
    expect(sincronizar).toHaveBeenCalledWith("42", { clerkUserId: "user_1", telefono: "+54 376 4000000" });
  });

  it("Alegra no disponible y sin perfil que sirva ⇒ 409 facturacion_no_disponible, en usted", async () => {
    espejo = null;
    getContacto.mockRejectedValue(new Error("Alegra 503 en /contacts/42: caído"));
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      error: "No pudimos obtener sus datos de facturación. Inténtelo de nuevo en unos minutos.",
      motivo: "facturacion_no_disponible",
    });
  });
});

describe("POST /api/pedidos — teléfono desde el espejo (0036 del CRM)", () => {
  beforeEach(() => {
    identidad = vinculado;
    espejo = null;
    perfil = null;
    getContacto.mockReset();
    crearPedido.mockReset();
    crearPedido.mockResolvedValue({ id: "p-1", repetido: false, cuotasMax: null });
    guardarTelefonoSiFalta.mockReset();
    sincronizar.mockReset();
    tareasAfter = [];
  });

  it("vinculado con celular en Alegra y sin teléfono tipeado ⇒ 201 con el celular, sin subir nada", async () => {
    espejo = fila({ mobile: "11 5000-0000", phonePrimary: "011 4000-0000" });
    const r = await post({ contactoTelefono: "" });
    expect(r.status).toBe(201);
    expect(datosDelPedido().contactoTelefono).toBe("11 5000-0000");
    expect(tareasAfter).toHaveLength(1);
    expect(guardarTelefonoSiFalta).not.toHaveBeenCalled();
  });

  it("sin celular usa el principal y después el secundario", async () => {
    espejo = fila({ phoneSecondary: "011 4000-0001" });
    await post({ contactoTelefono: "" });
    expect(datosDelPedido().contactoTelefono).toBe("011 4000-0001");
  });

  it("vinculado con teléfono en Alegra que tipea otro ⇒ va el tipeado al pedido, Alegra no se toca", async () => {
    espejo = fila({ phonePrimary: "011 4000-0000" });
    const r = await post({ contactoTelefono: "+54 376 4111111" });
    expect(r.status).toBe(201);
    expect(datosDelPedido().contactoTelefono).toBe("+54 376 4111111");
    expect(tareasAfter).toHaveLength(1);
  });

  it("vinculado sin teléfono en Alegra ⇒ lo tipeado va al pedido y se sube a Alegra en after()", async () => {
    espejo = fila();
    const r = await post();
    expect(r.status).toBe(201);
    expect(datosDelPedido().contactoTelefono).toBe("+54 376 4000000");
    expect(tareasAfter).toHaveLength(2);
    await tareasAfter[0]();
    expect(sincronizar).toHaveBeenCalledWith("42", { clerkUserId: "user_1", telefono: "+54 376 4000000" });
    // Con Clerk el perfil lo aprende también (se precarga mientras el espejo se pone al día).
    expect(guardarTelefonoSiFalta).toHaveBeenCalledWith("user_1", "+54 376 4000000");
  });

  it("sólo cookie del CRM sin teléfono en Alegra ⇒ también se sube (sin perfil)", async () => {
    identidad = soloCookie;
    espejo = fila();
    await post();
    await tareasAfter[0]();
    expect(sincronizar).toHaveBeenCalledWith("42", { clerkUserId: null, telefono: "+54 376 4000000" });
    expect(guardarTelefonoSiFalta).not.toHaveBeenCalled();
  });

  it("un teléfono que no parece teléfono queda sólo en el pedido", async () => {
    espejo = fila();
    await post({ contactoTelefono: "llamar" });
    expect(datosDelPedido().contactoTelefono).toBe("llamar");
    expect(tareasAfter).toHaveLength(1);
  });

  it("vinculado sin teléfono en ningún lado y sin tipear ⇒ 400 en usted", async () => {
    espejo = fila();
    const r = await post({ contactoTelefono: "" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Faltan el nombre y el teléfono de contacto." });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("no vinculado sin teléfono ⇒ 400 antes de leer la facturación", async () => {
    identidad = { clerkUserId: "user_1", cliente: null };
    const r = await post({ contactoTelefono: "" });
    expect(r.status).toBe(400);
  });

  it("pedido repetido (misma clave) ⇒ no se sube nada", async () => {
    espejo = fila();
    crearPedido.mockResolvedValue({ id: "p-1", repetido: true, cuotasMax: null });
    await post();
    expect(tareasAfter).toHaveLength(0);
  });
});

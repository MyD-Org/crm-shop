import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbGrabadora,
  valoresInsertados,
  type ConsultaGrabada,
} from "@/db/__fixtures__/db-grabadora";

/**
 * Vinculación leyendo el ESPEJO de contactos del CRM (rebanada 3 de
 * `espejo-contactos-alegra`): con fila en el espejo, 0 requests a Alegra; sin
 * fila, exactamente UNA búsqueda en vivo (la de siempre). Datos inventados.
 */

// --- Base: grabadora que contesta según la consulta ---------------------------
let espejo: unknown[][] | Error = [];
let otpFila: unknown[] | null = null;
/** El contacto ya tiene un vínculo activo de OTRO usuario. */
let contactoDeOtro = false;
/** El insert del vínculo choca con `cl_contacto_activa` (carrera perdida). */
let insertChocaContacto = false;

function responder(c: ConsultaGrabada): unknown[][] | undefined {
  if (c.sql.includes('"alegra_contacts_shop"')) {
    if (espejo instanceof Error) throw espejo;
    return espejo;
  }
  if (c.sql.startsWith("select count(*)")) return [[0]];
  if (c.sql.includes('"client_links"."clerk_user_id" <>')) {
    return contactoDeOtro ? [["00000000-0000-0000-0000-0000000000ff"]] : [];
  }
  if (insertChocaContacto && c.sql.startsWith('insert into "shop"."client_links"')) {
    throw Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
  }
  if (c.sql.startsWith('update "shop"."link_otps" set "intentos"')) return [[1]];
  if (c.sql.startsWith("select") && c.sql.includes('"link_otps"')) return otpFila ? [otpFila] : [];
  if (c.sql.startsWith('insert into "shop"."client_links"') && c.sql.includes("returning")) {
    return [["00000000-0000-0000-0000-000000000001"]];
  }
  return [];
}

let grabadora = dbGrabadora(responder);
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

// --- Alegra en vivo: contadores ------------------------------------------------
const buscarContactosPorEmail = vi.fn();
const buscarContactoPorIdentificacion = vi.fn();
const getContacto = vi.fn();
const actualizarObservacionesContacto = vi.fn();
vi.mock("./alegra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./alegra")>()),
  actualizarObservacionesContacto: (id: string, obs: string) => actualizarObservacionesContacto(id, obs),
  buscarContactosPorEmail: (e: string) => buscarContactosPorEmail(e),
  buscarContactoPorIdentificacion: (d: string) => buscarContactoPorIdentificacion(d),
  getContacto: (id: string) => getContacto(id),
}));

const enviarEmail = vi.fn();
vi.mock("./email", () => ({
  enviarEmail: (o: unknown) => enviarEmail(o),
  enmascararEmail: () => "c***@cliente.example",
}));

// `after()` de Next: se juntan las tareas para correrlas cuando el test quiera.
let tareasAfter: Array<() => unknown> = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    tareasAfter.push(fn);
  },
}));
async function correrAfter() {
  const tareas = tareasAfter;
  tareasAfter = [];
  for (const t of tareas) await t();
}

import {
  confirmarVinculacion,
  fechaArgentina,
  intentarVinculacionPorEmail,
  lineaEmailAlternativo,
  MENSAJE_VINCULADA_A_OTRO,
  observacionesConEmail,
  registrarEmailAlternativo,
  solicitarVinculacion,
} from "./vinculacion";

/** Fila de la vista en el orden de `columnasVinculables`. */
function filaEspejo(
  id: string,
  extra: Partial<{ email: string | null; tipo: "corriente" | "contado"; lista: string | null }> = {},
) {
  return [
    id,
    `Cliente ${id} SA`,
    "20-12345678-9",
    extra.email === undefined ? "compras@cliente.example" : extra.email,
    ["client"],
    extra.lista === undefined ? "7" : extra.lista,
    "Mayorista",
    "active",
    extra.tipo ?? "corriente",
  ];
}

const insertsEn = (tabla: string) =>
  grabadora.consultas.filter((c) => c.sql.startsWith(`insert into "shop"."${tabla}"`));

let usuario = 0;
/** Un usuario distinto por test: el rate limit vive en memoria del proceso. */
const nuevoUsuario = () => `user_test_${++usuario}`;

beforeEach(() => {
  vi.stubEnv("SHOP_TENANT_ID", "tenant-test");
  vi.stubEnv("OTP_SECRET", "secreto-de-prueba");
  espejo = [];
  otpFila = null;
  contactoDeOtro = false;
  insertChocaContacto = false;
  tareasAfter = [];
  grabadora = dbGrabadora(responder);
  buscarContactosPorEmail.mockReset().mockResolvedValue([]);
  buscarContactoPorIdentificacion.mockReset().mockResolvedValue(null);
  getContacto.mockReset();
  actualizarObservacionesContacto.mockReset().mockResolvedValue({});
  enviarEmail.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("intentarVinculacionPorEmail", () => {
  it("hit en el espejo: vincula con los datos de la fila y 0 llamadas a Alegra", async () => {
    espejo = [filaEspejo("42")];
    const r = await intentarVinculacionPorEmail(nuevoUsuario(), "Compras@Cliente.example");
    expect(r).toEqual({ alegraContactId: "42", razonSocial: "Cliente 42 SA" });
    expect(buscarContactosPorEmail).not.toHaveBeenCalled();
    const [insert] = insertsEn("client_links");
    expect(valoresInsertados(insert)).toMatchObject({
      alegra_contact_id: "42",
      razon_social: "Cliente 42 SA",
      cuit: "20-12345678-9",
      id_price_list: "7",
      tipo_cuenta: "corriente",
      estado: "activa",
      metodo: "email_verificado",
    });
  });

  it("email compartido por dos clientes en el espejo: no vincula (ambiguo)", async () => {
    espejo = [filaEspejo("42"), filaEspejo("43")];
    expect(await intentarVinculacionPorEmail(nuevoUsuario(), "compras@cliente.example")).toBeNull();
    expect(buscarContactosPorEmail).not.toHaveBeenCalled();
    expect(valoresInsertados(insertsEn("client_links")[0])).toMatchObject({
      alegra_contact_id: "ambiguo",
      estado: "sin_coincidencia",
    });
  });

  it("miss en el espejo: exactamente 1 búsqueda en vivo; si trae un cliente, vincula", async () => {
    buscarContactosPorEmail.mockResolvedValue([
      { id: "9", name: "Cliente Nuevo", type: ["client"], term: { days: 0 }, priceList: null },
    ]);
    const r = await intentarVinculacionPorEmail(nuevoUsuario(), "nuevo@cliente.example");
    expect(buscarContactosPorEmail).toHaveBeenCalledTimes(1);
    expect(r?.alegraContactId).toBe("9");
    expect(valoresInsertados(insertsEn("client_links")[0])).toMatchObject({
      alegra_contact_id: "9",
      tipo_cuenta: "contado",
    });
  });

  it("solo proveedor en vivo (el espejo ya filtra clientes): sin_coincidencia tras el respaldo", async () => {
    buscarContactosPorEmail.mockResolvedValue([{ id: "5", name: "Proveedor", type: ["provider"] }]);
    expect(await intentarVinculacionPorEmail(nuevoUsuario(), "ventas@proveedor.example")).toBeNull();
    expect(buscarContactosPorEmail).toHaveBeenCalledTimes(1);
    expect(valoresInsertados(insertsEn("client_links")[0])).toMatchObject({
      alegra_contact_id: "",
      estado: "sin_coincidencia",
    });
  });

  it("miss en el espejo y Alegra caída: NO graba sin_coincidencia", async () => {
    buscarContactosPorEmail.mockRejectedValue(new Error("Alegra 503"));
    expect(await intentarVinculacionPorEmail(nuevoUsuario(), "nuevo@cliente.example")).toBeNull();
    expect(insertsEn("client_links")).toHaveLength(0);
  });

  it("contacto ya vinculado a otro usuario: null, sin vincular y sin grabar sin_coincidencia", async () => {
    espejo = [filaEspejo("42")];
    contactoDeOtro = true;
    expect(await intentarVinculacionPorEmail(nuevoUsuario(), "compras@cliente.example")).toBeNull();
    expect(insertsEn("client_links")).toHaveLength(0);
  });

  it("pierde la carrera contra otro usuario (23505 de cl_contacto_activa): null, sin 500", async () => {
    espejo = [filaEspejo("42")];
    insertChocaContacto = true;
    expect(await intentarVinculacionPorEmail(nuevoUsuario(), "compras@cliente.example")).toBeNull();
  });

  it("el insert del vínculo absorbe SOLO la carrera del mismo usuario (on conflict a cl_user_activa)", async () => {
    espejo = [filaEspejo("42")];
    await intentarVinculacionPorEmail(nuevoUsuario(), "compras@cliente.example");
    expect(insertsEn("client_links")[0].sql).toMatch(
      /on conflict \("clerk_user_id"\) where "estado" = 'activa' do nothing/,
    );
  });

  it("el espejo falla (permiso): cae a la búsqueda en vivo de siempre", async () => {
    espejo = Object.assign(new Error("permission denied"), { code: "42501" });
    await intentarVinculacionPorEmail(nuevoUsuario(), "nuevo@cliente.example");
    expect(buscarContactosPorEmail).toHaveBeenCalledTimes(1);
  });
});

describe("solicitarVinculacion", () => {
  it('CUIT "20123456789" contra "20-12345678-9" del espejo: hit con 0 llamadas a Alegra', async () => {
    espejo = [filaEspejo("42")];
    const r = await solicitarVinculacion(nuevoUsuario(), "20123456789");
    expect(r).toEqual({ ok: true, expiraEn: 10 });
    expect(buscarContactoPorIdentificacion).not.toHaveBeenCalled();
    const consultaEspejo = grabadora.consultas.find((c) => c.sql.includes("alegra_contacts_shop"));
    expect(consultaEspejo?.params).toContain("20123456789");
    expect(valoresInsertados(insertsEn("link_otps")[0])).toMatchObject({ alegra_contact_id: "42" });
    expect(enviarEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "compras@cliente.example" }));
  });

  it("CUIT con guiones ingresado: el espejo recibe sólo dígitos", async () => {
    espejo = [filaEspejo("42")];
    await solicitarVinculacion(nuevoUsuario(), "20-12345678-9");
    const consultaEspejo = grabadora.consultas.find((c) => c.sql.includes("alegra_contacts_shop"));
    expect(consultaEspejo?.params).toContain("20123456789");
    expect(buscarContactoPorIdentificacion).not.toHaveBeenCalled();
  });

  it("CUIT duplicado: la consulta desempata de forma determinística (cliente, id menor)", async () => {
    espejo = [filaEspejo("42")];
    await solicitarVinculacion(nuevoUsuario(), "20123456789");
    const consultaEspejo = grabadora.consultas.find((c) => c.sql.includes("alegra_contacts_shop"));
    expect(consultaEspejo?.sql).toMatch(/order by \('client' = ANY\(.*\)\) DESC, CASE WHEN .* END ASC NULLS LAST/);
    expect(consultaEspejo?.sql).toMatch(/limit \$\d+$/);
  });

  it("miss en el espejo: exactamente 1 búsqueda en vivo; sin resultado, respuesta uniforme", async () => {
    const r = await solicitarVinculacion(nuevoUsuario(), "30111222333");
    expect(buscarContactoPorIdentificacion).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, expiraEn: 10 });
    expect(insertsEn("link_otps")).toHaveLength(0);
  });

  it("miss en el espejo y Alegra caída: servicio_caido (como hoy)", async () => {
    buscarContactoPorIdentificacion.mockRejectedValue(new Error("Alegra 503"));
    const r = await solicitarVinculacion(nuevoUsuario(), "30111222333");
    expect(r).toMatchObject({ ok: false, motivo: "servicio_caido" });
  });

  it("contacto vinculado a otro usuario: rechaza con el mensaje y no manda código", async () => {
    espejo = [filaEspejo("42")];
    contactoDeOtro = true;
    const r = await solicitarVinculacion(nuevoUsuario(), "20123456789");
    expect(r).toEqual({ ok: false, motivo: "vinculada_a_otro", detalle: MENSAJE_VINCULADA_A_OTRO });
    expect(MENSAJE_VINCULADA_A_OTRO).toBe(
      "Esta cuenta ya está vinculada a otro usuario de la tienda. Si no recuerda con qué email la vinculó, comuníquese con la sucursal.",
    );
    expect(insertsEn("link_otps")).toHaveLength(0);
    expect(enviarEmail).not.toHaveBeenCalled();
    // El chequeo es sólo base: con fila en el espejo, 0 requests a Alegra.
    expect(buscarContactoPorIdentificacion).not.toHaveBeenCalled();
    expect(getContacto).not.toHaveBeenCalled();
  });

  it("fila del espejo sin email: respuesta uniforme, sin código", async () => {
    espejo = [filaEspejo("42", { email: null })];
    expect(await solicitarVinculacion(nuevoUsuario(), "20123456789")).toEqual({ ok: true, expiraEn: 10 });
    expect(insertsEn("link_otps")).toHaveLength(0);
    expect(enviarEmail).not.toHaveBeenCalled();
  });
});

describe("confirmarVinculacion", () => {
  function prepararOtp(usuarioId: string, codigo: string) {
    const hash = createHmac("sha256", "secreto-de-prueba").update(`${usuarioId}:${codigo}`).digest("hex");
    const ahora = Date.now();
    // Orden de columnas de `link_otps`.
    otpFila = [
      "00000000-0000-0000-0000-00000000000a",
      usuarioId,
      "42",
      hash,
      "c***@cliente.example",
      0,
      new Date(ahora + 5 * 60_000).toISOString(),
      null,
      new Date(ahora - 60_000).toISOString(),
    ];
  }

  it("Alegra en vivo responde: congela sus datos (no los del espejo)", async () => {
    const u = nuevoUsuario();
    prepararOtp(u, "123456");
    espejo = [filaEspejo("42", { tipo: "contado" })];
    getContacto.mockResolvedValue({ id: "42", name: "En Vivo SA", term: { days: 30 }, priceList: null });
    const r = await confirmarVinculacion(u, "123456");
    expect(r).toEqual({ ok: true, alegraContactId: "42", razonSocial: "En Vivo SA" });
    expect(valoresInsertados(insertsEn("client_links")[0])).toMatchObject({
      razon_social: "En Vivo SA",
      tipo_cuenta: "corriente",
      id_price_list: null,
    });
  });

  it("Alegra caída + fila en el espejo: confirma con los datos del espejo", async () => {
    const u = nuevoUsuario();
    prepararOtp(u, "123456");
    espejo = [filaEspejo("42")];
    getContacto.mockRejectedValue(new Error("Alegra 503"));
    const r = await confirmarVinculacion(u, "123456");
    expect(r).toEqual({ ok: true, alegraContactId: "42", razonSocial: "Cliente 42 SA" });
    expect(valoresInsertados(insertsEn("client_links")[0])).toMatchObject({
      alegra_contact_id: "42",
      razon_social: "Cliente 42 SA",
      id_price_list: "7",
      tipo_cuenta: "corriente",
      metodo: "otp_email",
    });
  });

  it("Alegra caída y sin fila en el espejo: pide reintentar, sin vincular", async () => {
    const u = nuevoUsuario();
    prepararOtp(u, "123456");
    getContacto.mockRejectedValue(new Error("Alegra 503"));
    const r = await confirmarVinculacion(u, "123456");
    expect(r).toEqual({
      ok: false,
      detalle: "No pudimos completar la vinculación. Inténtelo de nuevo en unos minutos.",
    });
    expect(insertsEn("client_links")).toHaveLength(0);
  });

  it("otro usuario vinculó el contacto entre pedir y confirmar: mensaje, sin vincular", async () => {
    const u = nuevoUsuario();
    prepararOtp(u, "123456");
    getContacto.mockResolvedValue({ id: "42", name: "En Vivo SA" });
    contactoDeOtro = true;
    const r = await confirmarVinculacion(u, "123456");
    expect(r).toEqual({ ok: false, detalle: MENSAJE_VINCULADA_A_OTRO });
    expect(insertsEn("client_links")).toHaveLength(0);
  });

  it("carrera en el insert (23505 de cl_contacto_activa): mismo mensaje, sin 500", async () => {
    const u = nuevoUsuario();
    prepararOtp(u, "123456");
    getContacto.mockResolvedValue({ id: "42", name: "En Vivo SA" });
    insertChocaContacto = true;
    const r = await confirmarVinculacion(u, "123456");
    expect(r).toEqual({ ok: false, detalle: MENSAJE_VINCULADA_A_OTRO });
  });

  describe("email alternativo en las observaciones de Alegra", () => {
    it("email distinto: agrega UNA línea conservando las observaciones, después de responder", async () => {
      const u = nuevoUsuario();
      prepararOtp(u, "123456");
      getContacto.mockResolvedValue({
        id: "42",
        name: "En Vivo SA",
        email: "compras@cliente.example",
        observations: "Paga con cheque.",
      });
      const r = await confirmarVinculacion(u, "123456", " Otro@Cliente.example ");
      expect(r).toMatchObject({ ok: true, alegraContactId: "42" });
      // La respuesta no esperó a Alegra: el PUT recién sale en after().
      expect(actualizarObservacionesContacto).not.toHaveBeenCalled();
      await correrAfter();
      expect(actualizarObservacionesContacto).toHaveBeenCalledTimes(1);
      const [id, obs] = actualizarObservacionesContacto.mock.calls[0];
      expect(id).toBe("42");
      expect(obs).toMatch(
        /^Paga con cheque\.\nTienda online: también usa otro@cliente\.example \(vinculado el \d{2}\/\d{2}\/\d{4}\)$/,
      );

      // Segunda vez con esas observaciones ya escritas: no vuelve a escribir.
      getContacto.mockResolvedValue({ id: "42", email: "compras@cliente.example", observations: obs });
      await registrarEmailAlternativo("42", "otro@cliente.example");
      expect(actualizarObservacionesContacto).toHaveBeenCalledTimes(1);
    });

    it("el email ya figura en las observaciones: no hay PUT", async () => {
      const u = nuevoUsuario();
      prepararOtp(u, "123456");
      getContacto.mockResolvedValue({
        id: "42",
        email: "compras@cliente.example",
        observations: "También escribe desde OTRO@cliente.example",
      });
      await confirmarVinculacion(u, "123456", "otro@cliente.example");
      await correrAfter();
      expect(actualizarObservacionesContacto).not.toHaveBeenCalled();
    });

    it("el email de Clerk es el de Alegra (entre varios): ni se programa, ni PUT", async () => {
      const u = nuevoUsuario();
      prepararOtp(u, "123456");
      getContacto.mockResolvedValue({
        id: "42",
        email: "admin@cliente.example; Compras@Cliente.example",
      });
      await confirmarVinculacion(u, "123456", "compras@cliente.example");
      expect(tareasAfter).toHaveLength(0);
      await correrAfter();
      expect(actualizarObservacionesContacto).not.toHaveBeenCalled();
      expect(getContacto).toHaveBeenCalledTimes(1);
    });

    it("sin email verificado: no se anota nada", async () => {
      const u = nuevoUsuario();
      prepararOtp(u, "123456");
      getContacto.mockResolvedValue({ id: "42", email: "compras@cliente.example" });
      await confirmarVinculacion(u, "123456", undefined);
      expect(tareasAfter).toHaveLength(0);
    });

    it("Alegra falla (400 con code 429): la vinculación queda hecha y el log no lleva el email", async () => {
      const u = nuevoUsuario();
      prepararOtp(u, "123456");
      getContacto.mockResolvedValue({ id: "42", name: "En Vivo SA", email: "compras@cliente.example" });
      actualizarObservacionesContacto.mockRejectedValue(
        new Error('Alegra 400 en /contacts/42: {"code":429,"message":"Too many requests"}'),
      );
      const r = await confirmarVinculacion(u, "123456", "otro@cliente.example");
      expect(r).toMatchObject({ ok: true, alegraContactId: "42" });
      expect(insertsEn("client_links")).toHaveLength(1);
      await expect(correrAfter()).resolves.toBeUndefined();
      const logs = vi.mocked(console.error).mock.calls.map((c) => c.join(" "));
      const log = logs.find((l) => l.includes("email alternativo"));
      expect(log).toContain("contacto 42");
      expect(log).toContain("Alegra 400");
      expect(logs.join("\n")).not.toContain("otro@cliente.example");
    });
  });
});

describe("formato de la línea de observaciones", () => {
  it("fecha en hora de Buenos Aires, DD/MM/AAAA", () => {
    // 02:30 UTC del 25 = 23:30 del 24 en Argentina.
    expect(fechaArgentina(new Date("2026-09-25T02:30:00Z"))).toBe("24/09/2026");
    expect(fechaArgentina(new Date("2026-01-05T15:00:00Z"))).toBe("05/01/2026");
  });

  it("línea exacta", () => {
    expect(lineaEmailAlternativo("otro@cliente.example", new Date("2026-03-09T12:00:00Z"))).toBe(
      "Tienda online: también usa otro@cliente.example (vinculado el 09/03/2026)",
    );
  });

  it("observaciones vacías: solo la línea; con texto: se agrega al final", () => {
    const fecha = new Date("2026-03-09T12:00:00Z");
    const linea = "Tienda online: también usa otro@cliente.example (vinculado el 09/03/2026)";
    expect(observacionesConEmail(null, "a@cliente.example", "otro@cliente.example", fecha)).toBe(linea);
    expect(observacionesConEmail("Nota\n\n", null, "otro@cliente.example", fecha)).toBe(`Nota\n${linea}`);
    expect(observacionesConEmail("", "otro@cliente.example", "OTRO@cliente.example", fecha)).toBeNull();
  });
});

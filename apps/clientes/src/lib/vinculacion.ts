/**
 * Vinculación de una cuenta de acceso (Clerk) con un cliente de Alegra.
 *
 * El problema que resuelve: en Argentina el CUIT es PÚBLICO — está en cada
 * factura y en el padrón de AFIP. Si bastara con escribirlo, cualquiera se hace
 * pasar por un cliente mayorista y ve su lista de precios y su cuenta corriente.
 *
 * Hacen falta dos caminos, y el orden importa:
 *
 * 1. **Match por email verificado** (`intentarVinculacionPorEmail`) — el normal.
 *    Silencioso, automático, sin pedirle nada al cliente.
 * 2. **OTP por CUIT** (`solicitarVinculacion` + `confirmarVinculacion`) — el
 *    plan B, para quien entra con un mail distinto al que tiene cargado el
 *    sistema, o cuando dos contactos comparten casilla.
 *
 * Las dos reglas del OTP, que NO se pueden relajar:
 *
 *  1. El código va al email que YA está cargado en Alegra. Nunca a uno que el
 *     usuario escriba. Un código que vuelve a quien lo pidió no prueba nada.
 *  2. Acá se guarda un HMAC del código, no el código. Quien lea la base no
 *     puede usarlo.
 *
 * SOLO servidor.
 */

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { clientLinks, linkOtps } from "@/db/schema";
import {
  buscarContactoPorIdentificacion,
  buscarContactosPorEmail,
  esCliente,
  getContacto,
  idPriceListUsable,
} from "./alegra";
import { enmascararEmail, enviarEmail } from "./email";

/** Ventana de validez del código. */
const VIGENCIA_MIN = 10;
/** Intentos de verificación antes de quemar el código. */
const MAX_INTENTOS = 5;
/** Códigos que se pueden pedir por usuario dentro de la ventana de rate limit. */
const MAX_PEDIDOS = 3;
const VENTANA_RATE_LIMIT_MIN = 15;

/**
 * HMAC y no SHA-256 pelado: el espacio de un código de 6 dígitos es de un
 * millón, así que un hash sin secreto se rompe por fuerza bruta en microsegundos
 * y guardarlo sería teatro. Con el secreto, leer la base no alcanza.
 */
function hashCodigo(clerkUserId: string, codigo: string): string {
  const secret = process.env.OTP_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Falta OTP_SECRET (o SESSION_SECRET) en el entorno: sin secreto, el hash del código no protege nada.",
    );
  }
  return createHmac("sha256", secret).update(`${clerkUserId}:${codigo}`).digest("hex");
}

/** Comparación en tiempo constante, para no filtrar el código por timing. */
function hashesIguales(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Deja solo los dígitos del CUIT: la gente lo escribe con guiones y puntos. */
function normalizarCuit(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Vinculación automática por email verificado. Es el camino NORMAL; el OTP es
 * el plan B.
 *
 * La cadena de confianza se cierra sola y sin molestar a nadie:
 *
 *   Clerk dice:  esta persona controla juan@empresa.com   (ya verificado)
 *   Alegra dice: juan@empresa.com es ACME SRL
 *   ─────────────────────────────────────────────────────
 *                esta persona es ACME SRL
 *
 * Es exactamente la misma prueba que da el OTP —controlar la casilla que el
 * sistema ya tiene registrada— solo que Clerk la hizo al autenticar. Mandar un
 * código a una casilla cuya propiedad ya está verificada es pedir dos veces la
 * misma prueba.
 *
 * Se ejecuta como mucho UNA vez por usuario: el resultado (haya match o no)
 * queda registrado en `client_links`, así una cuenta sin coincidencia no
 * dispara una consulta a Alegra en cada visita.
 *
 * Devuelve el vínculo creado, o null si no hubo match.
 */
export async function intentarVinculacionPorEmail(
  clerkUserId: string,
  /**
   * Email **verificado** del usuario. Quien llama es responsable de haber
   * comprobado `verification.status === "verified"` — un email sin verificar
   * no prueba nada y vincularía a cualquiera con cualquier cliente. Ver
   * `identidadActual()` en auth.ts.
   */
  email: string | undefined,
): Promise<{ alegraContactId: string; razonSocial?: string } | null> {
  if (!email) return null;
  const db = getDb();

  // ¿Ya se resolvió antes? Cubre tanto un vínculo activo como un intento
  // previo sin resultado. Una sola query indexada.
  const [existente] = await db
    .select({ id: clientLinks.id })
    .from(clientLinks)
    .where(eq(clientLinks.clerkUserId, clerkUserId))
    .limit(1);
  if (existente) return null;

  let contactos;
  try {
    contactos = await buscarContactosPorEmail(email);
  } catch (err) {
    // Alegra caído: NO se registra "sin coincidencia", porque no buscamos de
    // verdad. Se reintenta en la próxima visita.
    console.error("[vinculacion] Alegra falló al buscar por email:", err);
    return null;
  }

  // Solo clientes: en esta cuenta la enorme mayoría de los contactos son
  // proveedores, y vincular a un proveedor sería un disparate.
  const clientes = contactos.filter(esCliente);

  // Dos contactos con la misma casilla: ambiguo. Elegir uno sería vincular a la
  // empresa equivocada la mitad de las veces. Va por OTP, donde el cliente dice
  // explícitamente qué CUIT es el suyo.
  if (clientes.length !== 1) {
    await db.insert(clientLinks).values({
      clerkUserId,
      alegraContactId: clientes.length === 0 ? "" : "ambiguo",
      estado: "sin_coincidencia",
      metodo: "email_verificado",
    });
    return null;
  }

  const contacto = clientes[0];
  await db.insert(clientLinks).values({
    clerkUserId,
    alegraContactId: String(contacto.id),
    razonSocial: contacto.name ?? null,
    cuit: contacto.identification ?? null,
    idPriceList: idPriceListUsable(contacto) ?? null,
    estado: "activa",
    metodo: "email_verificado",
  });

  return { alegraContactId: String(contacto.id), razonSocial: contacto.name };
}

export type ResultadoSolicitud =
  | { ok: true; destinoMasked: string; expiraEn: number }
  | { ok: false; motivo: "no_encontrado" | "sin_email" | "ya_vinculada" | "rate_limit" | "envio_fallido"; detalle: string };

/**
 * Paso 1: el cliente dice quién es (CUIT) y le mandamos un código a SU casilla.
 *
 * El contacto se busca ANTES de generar nada — al revés que el OTP del CRM, que
 * verificaba primero y recién después miraba si el cliente existía, con lo cual
 * nunca podía saber a dónde mandar el código.
 */
export async function solicitarVinculacion(
  clerkUserId: string,
  cuitRaw: string,
): Promise<ResultadoSolicitud> {
  const db = getDb();
  const cuit = normalizarCuit(cuitRaw);

  if (cuit.length < 8) {
    return { ok: false, motivo: "no_encontrado", detalle: "Ingresá un CUIT válido." };
  }

  // --- Rate limit: frena el barrido de CUITs y el bombardeo a una casilla ---
  const desde = new Date(Date.now() - VENTANA_RATE_LIMIT_MIN * 60_000);
  const [{ pedidos }] = await db
    .select({ pedidos: sql<number>`count(*)::int` })
    .from(linkOtps)
    .where(and(eq(linkOtps.clerkUserId, clerkUserId), gte(linkOtps.createdAt, desde)));

  if (pedidos >= MAX_PEDIDOS) {
    return {
      ok: false,
      motivo: "rate_limit",
      detalle: `Pediste demasiados códigos. Esperá ${VENTANA_RATE_LIMIT_MIN} minutos e intentá de nuevo.`,
    };
  }

  // --- ¿Ya tiene una vinculación activa? ---
  const [yaVinculado] = await db
    .select({ id: clientLinks.id })
    .from(clientLinks)
    .where(and(eq(clientLinks.clerkUserId, clerkUserId), eq(clientLinks.estado, "activa")))
    .limit(1);

  if (yaVinculado) {
    return {
      ok: false,
      motivo: "ya_vinculada",
      detalle: "Tu cuenta ya está vinculada. Si necesitás cambiarla, escribinos.",
    };
  }

  // --- Buscar el contacto en Alegra ---
  let contacto;
  try {
    contacto = await buscarContactoPorIdentificacion(cuit);
  } catch (err) {
    console.error("[vinculacion] Alegra falló al buscar el contacto:", err);
    return {
      ok: false,
      motivo: "envio_fallido",
      detalle: "No pudimos verificar el CUIT en este momento. Probá de nuevo en unos minutos.",
    };
  }

  if (!contacto) {
    return {
      ok: false,
      motivo: "no_encontrado",
      detalle: "No encontramos una cuenta con ese CUIT. Si ya sos cliente del local, escribinos y la damos de alta.",
    };
  }

  const email = contacto.email?.trim();
  if (!email) {
    // Caso frecuente en esta cuenta de Alegra: contactos viejos sin email.
    // No hay a dónde mandar el código, y NO se acepta uno que escriba el
    // usuario: sería devolverle la llave a quien la está pidiendo.
    return {
      ok: false,
      motivo: "sin_email",
      detalle: "Tu cuenta no tiene un email registrado. Pasá por el local o escribinos para cargarlo y vincularte.",
    };
  }

  // --- Generar y guardar ---
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + VIGENCIA_MIN * 60_000);
  const destinoMasked = enmascararEmail(email);

  await db.insert(linkOtps).values({
    clerkUserId,
    alegraContactId: String(contacto.id),
    codeHash: hashCodigo(clerkUserId, codigo),
    destinoMasked,
    expiresAt,
  });

  const envio = await enviarEmail({
    to: email,
    subject: `${codigo} es tu código para vincular tu cuenta`,
    text: `Tu código para vincular tu cuenta en la tienda de Central LED es ${codigo}. Vence en ${VIGENCIA_MIN} minutos.\n\nSi no pediste esto, ignorá este mensaje: nadie puede acceder a tu cuenta sin este código.`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin:0 0 24px">Central LED</p>
        <h1 style="font-size:20px;margin:0 0 12px;color:#0f172a">Vinculá tu cuenta</h1>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px">
          Usá este código para asociar tu cuenta corriente a tu usuario de la tienda.
        </p>
        <p style="font-size:34px;font-weight:800;letter-spacing:.18em;color:#0f172a;margin:0 0 24px">${codigo}</p>
        <p style="font-size:13px;color:#64748b;margin:0 0 8px">Vence en ${VIGENCIA_MIN} minutos.</p>
        <p style="font-size:13px;color:#64748b;margin:0">
          Si no pediste esto, ignorá este mensaje: nadie puede acceder a tu cuenta sin este código.
        </p>
      </div>`,
  });

  if (!envio.ok) {
    return {
      ok: false,
      motivo: "envio_fallido",
      detalle: "No pudimos enviarte el código. Probá de nuevo en unos minutos.",
    };
  }

  return { ok: true, destinoMasked, expiraEn: VIGENCIA_MIN };
}

export type ResultadoConfirmacion =
  | { ok: true; alegraContactId: string; razonSocial?: string }
  | { ok: false; detalle: string };

/**
 * Paso 2: el cliente escribe el código y, si coincide, se crea la vinculación.
 *
 * Los datos del contacto se releen de Alegra en este momento (no se confían del
 * paso 1): entre pedir el código y confirmarlo pudo cambiar la lista de precios.
 */
export async function confirmarVinculacion(
  clerkUserId: string,
  codigo: string,
): Promise<ResultadoConfirmacion> {
  const db = getDb();
  const limpio = codigo.replace(/\D/g, "");

  if (limpio.length !== 6) {
    return { ok: false, detalle: "El código tiene 6 dígitos." };
  }

  // El más reciente sin consumir. Pedir uno nuevo invalida al anterior por la
  // vía de que solo se mira este.
  const [otp] = await db
    .select()
    .from(linkOtps)
    .where(and(eq(linkOtps.clerkUserId, clerkUserId), isNull(linkOtps.consumedAt)))
    .orderBy(desc(linkOtps.createdAt))
    .limit(1);

  if (!otp) {
    return { ok: false, detalle: "No hay ningún código pendiente. Pedí uno nuevo." };
  }

  if (otp.expiresAt.getTime() < Date.now()) {
    return { ok: false, detalle: "El código venció. Pedí uno nuevo." };
  }

  if (otp.intentos >= MAX_INTENTOS) {
    return { ok: false, detalle: "Demasiados intentos fallidos. Pedí un código nuevo." };
  }

  if (!hashesIguales(otp.codeHash, hashCodigo(clerkUserId, limpio))) {
    await db
      .update(linkOtps)
      .set({ intentos: otp.intentos + 1 })
      .where(eq(linkOtps.id, otp.id));
    const restantes = MAX_INTENTOS - (otp.intentos + 1);
    return {
      ok: false,
      detalle:
        restantes > 0
          ? `Código incorrecto. Te quedan ${restantes} intentos.`
          : "Código incorrecto. Pedí un código nuevo.",
    };
  }

  // --- Código válido: releer el contacto y crear la vinculación ---
  let contacto;
  try {
    contacto = await getContacto(otp.alegraContactId);
  } catch (err) {
    console.error("[vinculacion] no se pudo releer el contacto:", err);
    return { ok: false, detalle: "No pudimos completar la vinculación. Probá de nuevo en unos minutos." };
  }

  await db.transaction(async (tx) => {
    // El código se consume dentro de la transacción: si la vinculación falla,
    // el código sigue vivo y el cliente no tiene que pedir otro.
    await tx
      .update(linkOtps)
      .set({ consumedAt: new Date() })
      .where(eq(linkOtps.id, otp.id));

    await tx.insert(clientLinks).values({
      clerkUserId,
      alegraContactId: otp.alegraContactId,
      razonSocial: contacto?.name ?? null,
      cuit: contacto?.identification ?? null,
      idPriceList: idPriceListUsable(contacto) ?? null,
      metodo: "otp_email",
    });
  });

  return {
    ok: true,
    alegraContactId: otp.alegraContactId,
    razonSocial: contacto?.name,
  };
}

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
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
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
import { permitir } from "./rate-limit";

/** Ventana de validez del código. */
const VIGENCIA_MIN = 10;
/** Intentos de verificación antes de quemar el código. */
const MAX_INTENTOS = 5;
/** Códigos que se pueden ENVIAR por usuario dentro de la ventana. */
const MAX_PEDIDOS = 3;
/**
 * Consultas por usuario dentro de la ventana, se envíe código o no.
 *
 * Es un límite distinto de MAX_PEDIDOS y es el que importa para la
 * enumeración: el de envíos solo cuenta los códigos que salieron, así que
 * sondear CUITs ajenos —que nunca llegan a generar uno— no lo movía nunca.
 * Diez alcanza de sobra para alguien que se equivoca tipeando su propio CUIT.
 */
const MAX_SONDEOS = 10;
const VENTANA_RATE_LIMIT_MIN = 15;

/**
 * HMAC y no SHA-256 pelado: el espacio de un código de 6 dígitos es de un
 * millón, así que un hash sin secreto se rompe por fuerza bruta en microsegundos
 * y guardarlo sería teatro. Con el secreto, leer la base no alcanza.
 */
function hashCodigo(clerkUserId: string, codigo: string): string {
  /**
   * Clave PROPIA, sin caer a `SESSION_SECRET`.
   *
   * `SESSION_SECRET` es el secreto de iron-session, y además está compartido
   * con el CRM porque la cookie es de dominio común. Usarlo también como clave
   * del HMAC ata dos cosas que no tienen por qué caer juntas: quien comprometa
   * el secreto de sesión de cualquiera de las dos apps podría además generar
   * los hashes de los códigos de vinculación.
   *
   * Sin la variable se corta acá, ruidosamente. Un OTP con una clave prestada
   * parece que funciona, que es lo peor que puede hacer.
   */
  const secret = process.env.OTP_SECRET;
  if (!secret) {
    throw new Error(
      "Falta OTP_SECRET en el entorno: sin secreto propio, el hash del código no protege nada.",
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
    await db
      .insert(clientLinks)
      .values({
        clerkUserId,
        alegraContactId: clientes.length === 0 ? "" : "ambiguo",
        estado: "sin_coincidencia",
        metodo: "email_verificado",
      })
      .onConflictDoNothing();
    return null;
  }

  const contacto = clientes[0];
  /**
   * El chequeo de `existente` de arriba y este insert NO son atómicos, y
   * `identidadActual()` corre en el layout, en la página y en las rutas de API
   * —que Next ejecuta en paralelo—. En el primer request de un usuario con
   * match, dos de esas llamadas ven "no existe" y las dos insertan: el índice
   * único parcial `cl_user_activa` hace tirar a la segunda y el usuario se come
   * un 500 justo en su primer login.
   *
   * Que gane cualquiera de las dos es indistinto: insertan lo mismo. Quien
   * llama relee el vínculo (`resolverVinculacion`), así que el perdedor de la
   * carrera igual devuelve la fila correcta.
   */
  await db
    .insert(clientLinks)
    .values({
      clerkUserId,
      alegraContactId: String(contacto.id),
      razonSocial: contacto.name ?? null,
      cuit: contacto.identification ?? null,
      idPriceList: idPriceListUsable(contacto) ?? null,
      estado: "activa",
      metodo: "email_verificado",
    })
    .onConflictDoNothing();

  return { alegraContactId: String(contacto.id), razonSocial: contacto.name };
}

export type ResultadoSolicitud =
  | { ok: true; expiraEn: number }
  | {
      ok: false;
      motivo: "formato" | "ya_vinculada" | "rate_limit" | "servicio_caido";
      detalle: string;
    };

/**
 * Paso 1: el cliente dice quién es (CUIT) y le mandamos un código a SU casilla.
 *
 * El contacto se busca ANTES de generar nada — al revés que el OTP del CRM, que
 * verificaba primero y recién después miraba si el cliente existía, con lo cual
 * nunca podía saber a dónde mandar el código.
 *
 * ── RESPUESTA UNIFORME ──────────────────────────────────────────────────────
 *
 * Todo lo que dependa de si ESE CUIT existe en Alegra devuelve exactamente la
 * misma respuesta: que se haya encontrado el contacto, que no exista, que
 * exista sin email cargado, o que el envío del mail falle.
 *
 * El motivo: en Argentina el CUIT es público (padrón de AFIP, cualquier
 * factura). Si la respuesta distinguiera esos casos, con una lista de CUITs
 * —y una cuenta de Google gratis— se reconstruye la cartera de clientes
 * mayoristas de Central LED junto con el email de contacto de cada uno. Eso es
 * información comercial, y para un competidor vale más que cualquier precio.
 *
 * Por eso tampoco se devuelve ya el destino enmascarado: decir "te lo mandamos
 * a j***@empresa.com" es confirmar que ese CUIT es cliente.
 *
 * Lo que SÍ se puede distinguir sin filtrar nada, y por eso se distingue:
 *  - `formato`: el CUIT está mal escrito. Es sintaxis, no existencia.
 *  - `ya_vinculada` y `rate_limit`: hablan de la cuenta de QUIEN PREGUNTA.
 *  - `servicio_caido`: Alegra no responde. Pasa igual para cualquier CUIT.
 *
 * Queda un canal residual por tiempo de respuesta: encontrar el contacto y
 * mandar el mail tarda más que no encontrarlo. Cerrarlo del todo pide responder
 * en tiempo constante; con el límite de sondeos de acá el costo de explotarlo
 * no compensa, pero conviene saber que está.
 */
export async function solicitarVinculacion(
  clerkUserId: string,
  cuitRaw: string,
): Promise<ResultadoSolicitud> {
  const db = getDb();
  const cuit = normalizarCuit(cuitRaw);

  /** La única respuesta para todo camino que dependa de la existencia del CUIT. */
  const uniforme = { ok: true, expiraEn: VIGENCIA_MIN } as const;

  /**
   * Límite de SONDEOS, antes de tocar Alegra a propósito: sin esto cada consulta
   * dispara una llamada a Alegra, así que el endpoint es además un amplificador
   * capaz de agotar la cuota de la API y voltear catálogo y checkout.
   */
  if (
    !permitir(
      `vinculacion:sondeo:${clerkUserId}`,
      MAX_SONDEOS,
      VENTANA_RATE_LIMIT_MIN * 60_000,
    )
  ) {
    return {
      ok: false,
      motivo: "rate_limit",
      detalle: `Hiciste demasiadas consultas. Esperá ${VENTANA_RATE_LIMIT_MIN} minutos e intentá de nuevo.`,
    };
  }

  if (cuit.length < 8) {
    return { ok: false, motivo: "formato", detalle: "Ingresá un CUIT válido." };
  }

  // --- Rate limit de ENVÍOS: evita usar la casilla de un cliente como buzón ---
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
    // Alegra caído no depende del CUIT consultado: falla igual para todos, así
    // que decirlo no filtra nada y evita que el cliente espere un mail que no
    // se generó nunca.
    console.error("[vinculacion] Alegra falló al buscar el contacto:", err);
    return {
      ok: false,
      motivo: "servicio_caido",
      detalle: "No pudimos verificar el CUIT en este momento. Probá de nuevo en unos minutos.",
    };
  }

  // A partir de acá, todo camino devuelve `uniforme`: cualquier diferencia
  // visible sería exactamente el dato que permite enumerar la cartera.
  if (!contacto) return uniforme;

  const email = contacto.email?.trim();
  // Caso frecuente en esta cuenta de Alegra: contactos viejos sin email. No hay
  // a dónde mandar el código, y NO se acepta uno que escriba el usuario: sería
  // devolverle la llave a quien la está pidiendo. Queda logueado para que un
  // operador pueda cargar el email cuando el cliente llame preguntando.
  if (!email) {
    console.warn(
      `[vinculacion] contacto ${contacto.id} sin email: no se puede vincular por OTP`,
    );
    return uniforme;
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

  // Un fallo de envío solo puede ocurrir cuando el contacto EXISTE y tiene
  // email: devolverlo como error distinto reabriría la fuga por la ventana.
  // Queda en el log, que es donde sirve.
  if (!envio.ok) {
    console.error(
      `[vinculacion] no se pudo enviar el código al contacto ${contacto.id}`,
    );
  }

  return uniforme;
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

  /**
   * El intento se consume ANTES de comparar, y lo incrementa Postgres.
   *
   * Con `intentos + 1` calculado en Node, N requests concurrentes leen todas el
   * mismo valor y escriben todas el mismo `+1`: el techo de MAX_INTENTOS nunca
   * se alcanza y el espacio de 6 dígitos se puede barrer por fuerza bruta
   * dentro de la ventana de vigencia. Acertar el código vincula la cuenta del
   * atacante a la cuenta corriente de un cliente, que es exactamente lo que
   * este mecanismo existe para impedir.
   *
   * `consumedAt is null` en el WHERE cierra además el replay de un código ya
   * usado con éxito.
   */
  const [intento] = await db
    .update(linkOtps)
    .set({ intentos: sql`${linkOtps.intentos} + 1` })
    .where(
      and(
        eq(linkOtps.id, otp.id),
        lt(linkOtps.intentos, MAX_INTENTOS),
        isNull(linkOtps.consumedAt),
      ),
    )
    .returning({ intentos: linkOtps.intentos });

  if (!intento) {
    return { ok: false, detalle: "Demasiados intentos fallidos. Pedí un código nuevo." };
  }

  if (!hashesIguales(otp.codeHash, hashCodigo(clerkUserId, limpio))) {
    const restantes = MAX_INTENTOS - intento.intentos;
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

  const vinculado = await db.transaction(async (tx) => {
    // El código se consume dentro de la transacción: si la vinculación falla,
    // el código sigue vivo y el cliente no tiene que pedir otro.
    await tx
      .update(linkOtps)
      .set({ consumedAt: new Date() })
      .where(eq(linkOtps.id, otp.id));

    // `solicitarVinculacion` ya rechaza a quien tiene un vínculo activo, pero
    // entre pedir el código y confirmarlo pudo crearse uno (el match automático
    // por email, por ejemplo). Sin esto, el índice único parcial tira y el
    // cliente ve un 500 en vez de enterarse de que ya está vinculado.
    const filas = await tx
      .insert(clientLinks)
      .values({
        clerkUserId,
        alegraContactId: otp.alegraContactId,
        razonSocial: contacto?.name ?? null,
        cuit: contacto?.identification ?? null,
        idPriceList: idPriceListUsable(contacto) ?? null,
        metodo: "otp_email",
      })
      .onConflictDoNothing()
      .returning({ id: clientLinks.id });

    return filas.length > 0;
  });

  if (!vinculado) {
    return {
      ok: false,
      detalle: "Tu cuenta ya está vinculada. Si necesitás cambiarla, escribinos.",
    };
  }

  return {
    ok: true,
    alegraContactId: otp.alegraContactId,
    razonSocial: contacto?.name,
  };
}

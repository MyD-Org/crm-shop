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
import { after } from "next/server";
import { getDb } from "@/db";
import { clientLinks, linkOtps } from "@/db/schema";
import {
  actualizarObservacionesContacto,
  buscarContactoPorIdentificacion,
  buscarContactosPorEmail,
  esCliente,
  getContacto,
  idPriceListUsable,
} from "./alegra";
import {
  emailsDelContacto,
  normalizarEmail,
  observacionesConEmail,
} from "./observaciones-contacto";
import {
  contactoPorDocumento,
  contactosPorEmail,
  vinculableDeAlegra,
  vinculablePorId,
  type ContactoVinculable,
} from "./contactos-espejo";
import { sincronizarContactoConPerfil } from "./contacto-write-through";
import { enmascararEmail, enviarEmail } from "./email";
import { getPerfilFacturacion } from "./facturacion-db";
import { armarMailCodigoVinculacion, urlLogoMail } from "./vinculacion-mail";
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

/** Deja solo los dígitos del documento: la gente lo escribe con guiones y puntos. */
function normalizarCuit(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Lo que se congela en `client_links` al vincular, venga del espejo o de Alegra. */
function snapshotDelContacto(c: ContactoVinculable | null) {
  return {
    razonSocial: c?.name ?? null,
    cuit: c?.identification ?? null,
    idPriceList: idPriceListUsable(c) ?? null,
    tipoCuenta: c?.tipoCuenta ?? "contado",
  };
}

/**
 * Un cliente de Alegra puede tener VARIOS usuarios de la tienda (la misma
 * persona con dos emails, o varias personas de una empresa). Cada vínculo nuevo
 * pasa por el código al email de Alegra, que es lo que prueba que la cuenta es
 * suya; un usuario, en cambio, tiene una sola vinculación activa.
 */

/**
 * Los inserts de vínculos activos apuntan el `on conflict` al índice del
 * usuario (`cl_user_activa`): la carrera del mismo usuario consigo mismo es
 * inocua y se absorbe.
 */
const conflictoDelUsuario = {
  target: clientLinks.clerkUserId,
  where: sql`"estado" = 'activa'`,
};

/**
 * Una lectura del espejo que falla (permiso, base caída) no puede cortar la
 * vinculación: se trata como "no está" y sigue el respaldo en vivo de siempre.
 */
async function delEspejoOVacio<T>(lectura: () => Promise<T>, vacio: T, que: string): Promise<T> {
  try {
    return await lectura();
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[vinculacion] el espejo de contactos falló al buscar por ${que} (${codigo ?? "sin código"})`);
    return vacio;
  }
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

  // Espejo primero (0 requests). Ya viene filtrado a clientes: en esta cuenta la
  // enorme mayoría de los contactos son proveedores, y vincular a un proveedor
  // sería un disparate.
  let clientes: ContactoVinculable[] = await delEspejoOVacio(
    () => contactosPorEmail(email),
    [],
    "email",
  );

  // Sin match en el espejo: UNA consulta en vivo antes de grabar
  // "sin coincidencia", que queda para siempre. El espejo puede estar atrasado
  // (contacto recién cargado que la sync todavía no vio).
  if (clientes.length === 0) {
    try {
      const enVivo = await buscarContactosPorEmail(email);
      clientes = enVivo.filter(esCliente).map(vinculableDeAlegra);
    } catch (err) {
      // Alegra caído: NO se registra "sin coincidencia", porque no buscamos de
      // verdad. Se reintenta en la próxima visita.
      console.error("[vinculacion] Alegra falló al buscar por email:", err);
      return null;
    }
  }

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
        ...snapshotDelContacto(contacto),
        estado: "activa",
        metodo: "email_verificado",
      })
      .onConflictDoNothing(conflictoDelUsuario);

  return { alegraContactId: String(contacto.id), razonSocial: contacto.name };
}

export type ResultadoSolicitud =
  | { ok: true; expiraEn: number }
  | {
      ok: false;
      motivo:
        | "formato"
        | "ya_vinculada"
        | "rate_limit"
        | "servicio_caido";
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
  const documento = cuitRaw.trim();

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
      detalle: `Hizo demasiadas consultas. Espere ${VENTANA_RATE_LIMIT_MIN} minutos e inténtelo de nuevo.`,
    };
  }

  // 6 dígitos = piso de un DNI o una cédula; menos que eso no es un documento.
  if (cuit.length < 6) {
    return { ok: false, motivo: "formato", detalle: "Ingrese un documento válido." };
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
      detalle: `Pidió demasiados códigos. Espere ${VENTANA_RATE_LIMIT_MIN} minutos e inténtelo de nuevo.`,
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
      detalle: "Su cuenta ya está vinculada. Si necesita cambiarla, escríbanos.",
    };
  }

  // --- Buscar el contacto: espejo (0 requests); sin fila, Alegra en vivo ---
  let contacto: ContactoVinculable | null = await delEspejoOVacio(
    () => contactoPorDocumento(documento),
    null,
    "documento",
  );
  if (!contacto) {
    try {
      const enVivo = await buscarContactoPorIdentificacion(documento);
      contacto = enVivo ? vinculableDeAlegra(enVivo) : null;
    } catch (err) {
    // Alegra caído no depende del CUIT consultado: falla igual para todos, así
    // que decirlo no filtra nada y evita que el cliente espere un mail que no
    // se generó nunca.
      console.error("[vinculacion] Alegra falló al buscar el contacto:", err);
      return {
        ok: false,
        motivo: "servicio_caido",
        detalle: "No pudimos verificar el documento en este momento. Inténtelo de nuevo en unos minutos.",
      };
    }
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
    ...armarMailCodigoVinculacion({
      codigo,
      vigenciaMin: VIGENCIA_MIN,
      tienda: "Central LED",
      logoUrl: urlLogoMail(),
    }),
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

export type ResultadoVerificacion =
  | { ok: true; razonSocial?: string; documento?: string }
  | { ok: false; detalle: string };

type Otp = typeof linkOtps.$inferSelect;

/**
 * Valida el código contra el OTP pendiente más reciente del usuario, sin
 * consumirlo. Cada llamada gasta un intento, también las correctas: por eso
 * confirmar (que viene después de verificar) tiene un intento más de techo, así
 * quien acertó en el último intento puede confirmar igual.
 */
async function validarCodigo(
  db: ReturnType<typeof getDb>,
  clerkUserId: string,
  codigo: string,
  techo: number = MAX_INTENTOS,
): Promise<{ ok: true; otp: Otp } | { ok: false; detalle: string }> {
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
    return { ok: false, detalle: "No hay ningún código pendiente. Pida uno nuevo." };
  }

  if (otp.expiresAt.getTime() < Date.now()) {
    return { ok: false, detalle: "El código venció. Pida uno nuevo." };
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
        lt(linkOtps.intentos, techo),
        isNull(linkOtps.consumedAt),
      ),
    )
    .returning({ intentos: linkOtps.intentos });

  if (!intento) {
    return { ok: false, detalle: "Demasiados intentos fallidos. Pida un código nuevo." };
  }

  if (!hashesIguales(otp.codeHash, hashCodigo(clerkUserId, limpio))) {
    const restantes = techo - intento.intentos;
    return {
      ok: false,
      detalle:
        restantes > 0
          ? `Código incorrecto. Le quedan ${restantes} intentos.`
          : "Código incorrecto. Pida un código nuevo.",
    };
  }

  return { ok: true, otp };
}

/**
 * El contacto del OTP, releído de Alegra (entre pedir el código y usarlo pudo
 * cambiar la lista de precios). Si Alegra no responde, alcanza con la fila del
 * espejo: el código ya probó que la persona controla la casilla del contacto.
 * `null` = ni Alegra ni el espejo: pedir que reintente.
 */
async function releerContacto(alegraContactId: string): Promise<ContactoVinculable | null> {
  try {
    const enVivo = await getContacto(alegraContactId);
    return enVivo ? vinculableDeAlegra(enVivo) : null;
  } catch (err) {
    console.error("[vinculacion] no se pudo releer el contacto:", err);
    return delEspejoOVacio(() => vinculablePorId(alegraContactId), null, "id");
  }
}

/**
 * Paso 2: el código es correcto y se le muestra al cliente a qué cuenta se va a
 * vincular, para que la confirme o cancele. NO vincula ni consume el código.
 *
 * Recién acá se revela la razón social: quien llega tiene el código enviado al
 * email registrado, la misma prueba que hace falta para vincular.
 */
export async function verificarCodigo(clerkUserId: string, codigo: string): Promise<ResultadoVerificacion> {
  const valido = await validarCodigo(getDb(), clerkUserId, codigo);
  if (!valido.ok) return valido;

  const contacto = await releerContacto(valido.otp.alegraContactId);
  if (!contacto) {
    return { ok: false, detalle: "No pudimos validar el código. Inténtelo de nuevo en unos minutos." };
  }
  return {
    ok: true,
    razonSocial: contacto.name ?? undefined,
    documento: contacto.identification ?? undefined,
  };
}

/**
 * El cliente dijo que la cuenta no es la suya: se consumen sus códigos
 * pendientes, así ninguno sirve para vincular después.
 */
export async function cancelarVinculacion(clerkUserId: string): Promise<void> {
  await getDb()
    .update(linkOtps)
    .set({ consumedAt: new Date() })
    .where(and(eq(linkOtps.clerkUserId, clerkUserId), isNull(linkOtps.consumedAt)));
}

/** ¿El perfil de facturación del usuario tiene este documento? (D2, sólo dígitos). */
async function perfilConDocumento(clerkUserId: string, documento: string | null): Promise<boolean> {
  const digitos = (documento ?? "").replace(/\D/g, "");
  if (!digitos) return false;
  try {
    const perfil = await getPerfilFacturacion(clerkUserId);
    return (perfil?.nroDoc ?? "").replace(/\D/g, "") === digitos;
  } catch {
    // Sin perfil legible no hay nada que subir: la vinculación sigue.
    return false;
  }
}

/**
 * Paso 3: el cliente confirmó la cuenta; se revalida el código y se crea la
 * vinculación con los datos releídos (ver `releerContacto`).
 */
export async function confirmarVinculacion(
  clerkUserId: string,
  codigo: string,
  /**
   * Email VERIFICADO del usuario en Clerk (o nada). Si no es uno de los del
   * contacto, se anota en sus observaciones de Alegra; ver
   * `registrarEmailAlternativo`.
   */
  emailUsuario?: string,
): Promise<ResultadoConfirmacion> {
  const db = getDb();
  const valido = await validarCodigo(db, clerkUserId, codigo, MAX_INTENTOS + 1);
  if (!valido.ok) return valido;
  const { otp } = valido;

  // --- Código válido: releer el contacto y crear la vinculación ---
  const contacto = await releerContacto(otp.alegraContactId);
  if (!contacto) {
    return { ok: false, detalle: "No pudimos completar la vinculación. Inténtelo de nuevo en unos minutos." };
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
        ...snapshotDelContacto(contacto),
        metodo: "otp_email",
      })
      .onConflictDoNothing(conflictoDelUsuario)
      .returning({ id: clientLinks.id });

    return filas.length > 0;
  });

  if (!vinculado) {
    return {
      ok: false,
      detalle: "Su cuenta ya está vinculada. Si necesita cambiarla, escríbanos.",
    };
  }

  const email = normalizarEmail(emailUsuario);
  // Si ya es uno de los emails del contacto (según lo recién leído), no hay nada
  // que anotar y no se gasta una request más a /contacts, que tiene tope propio.
  const emailAlternativo = email && !emailsDelContacto(contacto.email).includes(email) ? email : undefined;
  // D5 (change `contacto-fuente-unica`): si su perfil tiene el MISMO documento
  // que el contacto, lo que el perfil tenga y Alegra no, se sube (sólo vacíos).
  const perfilConMismoDoc = await perfilConDocumento(clerkUserId, contacto.identification);
  if (emailAlternativo || perfilConMismoDoc) {
    const alegraContactId = otp.alegraContactId;
    // En segundo plano: la vinculación no espera a Alegra. Un solo PUT como
    // mucho, con las observaciones y los vacíos juntos.
    after(() => sincronizarContactoConPerfil(alegraContactId, { clerkUserId, emailAlternativo }));
  }

  return {
    ok: true,
    alegraContactId: otp.alegraContactId,
    razonSocial: contacto?.name ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Email alternativo en las observaciones del contacto de Alegra
// ---------------------------------------------------------------------------

// La lógica pura vive en observaciones-contacto.ts; se reexporta por compatibilidad.
export {
  emailsDelContacto,
  fechaArgentina,
  lineaEmailAlternativo,
  observacionesConEmail,
} from "./observaciones-contacto";

/**
 * Anota en las observaciones del contacto de Alegra el email con el que el
 * cliente usa la tienda, cuando no es ninguno de los que tiene cargados.
 *
 * ── PRIMERA ESCRITURA DEL SHOP SOBRE UN CONTACTO DE ALEGRA ──────────────────
 *
 * Hasta acá el Shop solo LEÍA contactos. Se decidió escribir porque el que
 * vincula por OTP es justamente quien entra con un mail que la sucursal no
 * conoce: sin esto, cuando llama o aparece un pedido con ese mail, nadie en la
 * sucursal sabe de qué cliente es. El alcance es mínimo a propósito:
 *  - SOLO cambia `observations` (Alegra exige reenviar nombre, condición de
 *    IVA y documento, que van sin tocar), agregando una línea al final y conservando
 *    el texto que ya había (se lee en vivo justo antes, no del espejo).
 *  - NO se toca `email`: de ahí sale a dónde van las facturas y los códigos
 *    de vinculación; cambiarlo desde la tienda sería otorgar acceso.
 *  - Idempotente: si el email ya figura, no se escribe.
 *  - Corre en `after()`: la vinculación ya está hecha y no espera a Alegra. Si
 *    falla (incluido el 400 con `{"code":429}` de /contacts), se loguea y listo;
 *    no hay reintento, es un dato de cortesía para la sucursal.
 *
 * El log lleva solo el id del contacto: nada del email ni de las observaciones.
 */
export async function registrarEmailAlternativo(
  alegraContactId: string,
  email: string,
  fecha: Date = new Date(),
): Promise<void> {
  try {
    const contacto = await getContacto(alegraContactId);
    const nuevas = observacionesConEmail(contacto?.observations, contacto?.email, email, fecha);
    if (nuevas === null || !contacto) return;
    await actualizarObservacionesContacto({ ...contacto, id: alegraContactId }, nuevas);
  } catch (err) {
    // El mensaje de apiFetch trae el body de Alegra: solo se loguea el status.
    const estado =
      err instanceof Error ? (err.message.match(/^Alegra (\d+)/)?.[1] ?? "sin status") : "sin status";
    console.error(
      `[vinculacion] no se pudo anotar el email alternativo en el contacto ${alegraContactId} (Alegra ${estado})`,
    );
  }
}

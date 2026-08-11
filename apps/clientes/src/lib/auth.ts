/**
 * Identidad del shop. SOLO servidor.
 *
 * Hay DOS identidades y no conviene mezclarlas nunca:
 *
 * - **Acceso** (Clerk): quién está navegando. Un email de Google.
 * - **Comercial** (Alegra): qué cliente es. Un CUIT, con su lista de precios.
 *
 * `clienteActual()` devuelve la comercial, que es lo que necesitan el checkout y
 * los pedidos. Puede ser `null` aunque haya sesión de Clerk válida: es alguien
 * logueado que todavía no vinculó una cuenta corriente, y compra a lista
 * general. Ver `identidadActual()` para el objeto completo.
 */

import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clientLinks } from "@/db/schema";
import { getContacto, idPriceListUsable } from "./alegra";
import { intentarVinculacionPorEmail } from "./vinculacion";
import { sessionOptions, type SessionData } from "./session";

/** Datos comerciales de un cliente ya resuelto. */
export interface ClienteComercial {
  codigocliente: string;
  razonsocial?: string;
  cuit?: string;
  email?: string;
  tipoCuenta?: "corriente" | "contado";
  idPriceList?: string;
  /** De dónde salió: la vinculación propia o la cookie heredada del CRM. */
  origen: "vinculacion" | "cookie_crm";
}

export interface Identidad {
  /** Id de Clerk. null = visitante anónimo. */
  clerkUserId: string | null;
  email?: string;
  nombre?: string;
  /** null = logueado pero sin cuenta corriente vinculada. */
  cliente: ClienteComercial | null;
}

/** Sesión heredada del CRM (cookie compartida en .cliente.example). */
async function sesionCrm(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const s = await getIronSession<SessionData>(cookieStore, sessionOptions);
    return s.isLoggedIn && s.codigocliente ? s : null;
  } catch {
    // Sin SESSION_SECRET configurado, iron-session tira. No es motivo para
    // tumbar el shop: simplemente no hay sesión heredada.
    return null;
  }
}

/** Vinculación activa de un usuario de Clerk, si tiene. */
async function vinculacionDe(clerkUserId: string) {
  const [fila] = await getDb()
    .select()
    .from(clientLinks)
    .where(
      and(
        eq(clientLinks.clerkUserId, clerkUserId),
        eq(clientLinks.estado, "activa"),
      ),
    )
    .limit(1);
  return fila ?? null;
}

/**
 * Resuelve la vinculación, intentando el match automático por email verificado
 * la primera vez que vemos a este usuario.
 *
 * El intento es de una sola vez en la vida del usuario: `intentarVinculacionPorEmail`
 * registra el resultado —haya match o no— así una cuenta sin coincidencia no
 * dispara una consulta a Alegra en cada request.
 */
async function resolverVinculacion(clerkUserId: string, email?: string) {
  const existente = await vinculacionDe(clerkUserId);
  if (existente) return existente;

  const auto = await intentarVinculacionPorEmail(clerkUserId, email);
  if (!auto) return null;

  return vinculacionDe(clerkUserId);
}

/**
 * Identidad completa del request.
 *
 * Orden de resolución: primero la vinculación propia (es la que controlamos),
 * después la cookie del CRM como puente para quien ya estaba logueado ahí antes
 * de que existiera Clerk. La cookie es transitoria y se va a apagar; mientras
 * exista, un cliente que llega desde el CRM no tiene que re-probar nada.
 */
export async function identidadActual(): Promise<Identidad> {
  const { userId } = await auth();

  if (!userId) {
    // Sin Clerk todavía puede haber cookie del CRM (usuario viejo del portal).
    const crm = await sesionCrm();
    return {
      clerkUserId: null,
      email: crm?.email,
      nombre: crm?.razonsocial,
      cliente: crm
        ? {
            codigocliente: crm.codigocliente!,
            razonsocial: crm.razonsocial,
            cuit: crm.cuit,
            email: crm.email,
            tipoCuenta: crm.tipoCuenta,
            origen: "cookie_crm",
          }
        : null,
    };
  }

  const user = await currentUser();
  const emailPrimario = user?.primaryEmailAddress;
  const email = emailPrimario?.emailAddress;
  const nombre = user?.fullName ?? undefined;

  /**
   * SOLO un email VERIFICADO habilita la vinculación automática.
   *
   * Es la condición de la que depende todo el mecanismo. El razonamiento es
   * "Clerk probó que esta persona controla la casilla, y Alegra dice de quién
   * es esa casilla" — si el email no está verificado, el primer eslabón no
   * existe y la cadena no prueba nada.
   *
   * Sin este chequeo, cualquiera se registra con el email de un cliente (que
   * está en sus facturas, en su web, en una tarjeta) y queda vinculado a esa
   * empresa: su lista de precios, su cuenta corriente y —vía `esDeSuDueno`—
   * TODO su historial de pedidos.
   *
   * No alcanza con que hoy el dashboard tenga "Verify at sign-up" activado:
   * eso es configuración que alguien puede apagar sin darse cuenta de que
   * estaba sosteniendo una garantía de seguridad. Se verifica en el código.
   */
  const emailVerificado =
    emailPrimario?.verification?.status === "verified" ? email : undefined;

  const link = await resolverVinculacion(userId, emailVerificado);
  if (link) {
    return {
      clerkUserId: userId,
      email,
      nombre,
      cliente: {
        codigocliente: link.alegraContactId,
        razonsocial: link.razonSocial ?? undefined,
        cuit: link.cuit ?? undefined,
        email: email ?? undefined,
        tipoCuenta: (link.tipoCuenta as "corriente" | "contado") ?? undefined,
        idPriceList: link.idPriceList ?? undefined,
        origen: "vinculacion",
      },
    };
  }

  // Logueado con Clerk pero sin vincular: si trae cookie del CRM la honramos,
  // así el cliente viejo no pierde sus precios al pasarse a Google.
  const crm = await sesionCrm();
  return {
    clerkUserId: userId,
    email,
    nombre,
    cliente: crm
      ? {
          codigocliente: crm.codigocliente!,
          razonsocial: crm.razonsocial,
          cuit: crm.cuit,
          email: crm.email,
          tipoCuenta: crm.tipoCuenta,
          origen: "cookie_crm",
        }
      : null,
  };
}

/**
 * Cliente comercial del request, o null.
 *
 * Firma compatible con lo que ya consumen /api/pedidos y el checkout: exponen
 * `codigocliente`, `razonsocial`, `cuit`, `email`, `tipoCuenta`.
 */
export async function clienteActual(): Promise<ClienteComercial | null> {
  return (await identidadActual()).cliente;
}

/** ¿Hay alguien logueado, aunque no tenga cuenta corriente vinculada? */
export async function estaLogueado(): Promise<boolean> {
  const { userId } = await auth();
  if (userId) return true;
  return (await sesionCrm()) !== null;
}

/**
 * Identificador estable y BARATO de quien hace el request, o null si no hay
 * sesión. Pensado para rate limiting.
 *
 * No usa `identidadActual()` a propósito: esa sale a la red (Clerk
 * `currentUser`, y por vía de la vinculación puede llegar a Alegra), lo que en
 * un endpoint que se llama mientras el usuario tipea saldría más caro que lo
 * que se está limitando. Acá alcanza con el JWT de Clerk o la cookie del CRM,
 * las dos locales.
 */
export async function claveSolicitante(): Promise<string | null> {
  const { userId } = await auth();
  if (userId) return `clerk:${userId}`;

  const crm = await sesionCrm();
  return crm?.codigocliente ? `crm:${crm.codigocliente}` : null;
}

/**
 * Lista de precios del cliente en Alegra.
 *
 * Se re-lee de Alegra en vez de confiar en el snapshot de `client_links`: la
 * lista asignada la cambia un operador en Alegra, y cotizarle a alguien con una
 * lista vieja es cobrarle mal. Si Alegra no responde, cae al snapshot y después
 * a la lista principal — que esté lento no puede impedir comprar.
 */
export async function idPriceListDe(
  codigocliente: string,
): Promise<string | undefined> {
  try {
    const contacto = await getContacto(codigocliente);
    // Alegra respondió: su palabra es la final. Si el contacto no tiene lista, o
    // la que tiene está dada de baja, se devuelve `undefined` y se cotiza con la
    // lista principal. NO se cae al snapshot: el snapshot es más viejo, así que
    // usarlo acá sería resucitar justamente la lista que Alegra dio de baja.
    return idPriceListUsable(contacto);
  } catch (err) {
    console.error(`[auth] no se pudo leer la lista de precios de ${codigocliente}:`, err);
  }

  // Solo se llega acá si Alegra NO respondió. Ahí sí el snapshot es mejor que
  // nada: es la última lista que le conocimos al cliente.
  const [fila] = await getDb()
    .select({ idPriceList: clientLinks.idPriceList })
    .from(clientLinks)
    .where(
      and(
        eq(clientLinks.alegraContactId, codigocliente),
        eq(clientLinks.estado, "activa"),
      ),
    )
    .limit(1);

  return fila?.idPriceList ?? undefined;
}

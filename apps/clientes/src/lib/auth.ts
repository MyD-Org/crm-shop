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

import { cache } from "react";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clientLinks } from "@/db/schema";
import { intentarVinculacionPorEmail } from "./vinculacion";
import { comercialEspejo } from "./contactos-espejo";
import { nombrePila } from "./nombre-pila";
import { esRolAdmin } from "./rol-admin";
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
  /**
   * Para saludar en Mi cuenta: `firstName` de Clerk → primera palabra del
   * nombre completo → razón social. null = se saluda con "cliente". Ver
   * `nombre-pila.ts`. `nombre` se conserva aparte: lo usa el header.
   */
  nombrePila: string | null;
  /** null = logueado pero sin cuenta corriente vinculada. */
  cliente: ClienteComercial | null;
  /** Rol admin (Clerk publicMetadata.role). La cookie del CRM NUNCA lo otorga. */
  esAdmin: boolean;
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
 * Tipo de cuenta y lista de precios según el espejo de contactos del CRM, o
 * `null` si no hay fila activa o la vista no responde (en ese caso manda el
 * snapshot de `client_links`). 1 query, 0 requests a Alegra.
 */
async function comercialDelEspejo(alegraId: string) {
  try {
    return await comercialEspejo(alegraId);
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[auth] el espejo de contactos no respondió (${codigo ?? "sin código"}): se usa el snapshot`);
    return null;
  }
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
 *
 * Envuelta en `cache()`: en un mismo request la piden el layout raíz, el
 * header, el layout de Mi cuenta y la página. Sin esto cada uno volvería a
 * salir a Clerk (y a la base por la vinculación). Fuera de un render de React
 * (route handlers) `cache` no memoiza y se comporta como la función sola.
 */
export const identidadActual = cache(async function identidadActual(): Promise<Identidad> {
  const { userId } = await auth();

  if (!userId) {
    // Sin Clerk todavía puede haber cookie del CRM (usuario viejo del portal).
    const crm = await sesionCrm();
    return {
      clerkUserId: null,
      email: crm?.email,
      nombre: crm?.razonsocial,
      nombrePila: nombrePila({ razonSocial: crm?.razonsocial }),
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
      esAdmin: false,
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
    // El espejo gana sobre el snapshot de la vinculación: la lista o el plazo
    // pudieron cambiar en Alegra después de vincular. Sin fila, el snapshot.
    const espejo = await comercialDelEspejo(link.alegraContactId);
    return {
      clerkUserId: userId,
      email,
      nombre,
      nombrePila: nombrePila({
        firstName: user?.firstName,
        fullName: user?.fullName,
        razonSocial: link.razonSocial,
      }),
      cliente: {
        codigocliente: link.alegraContactId,
        razonsocial: link.razonSocial ?? undefined,
        cuit: link.cuit ?? undefined,
        email: email ?? undefined,
        tipoCuenta:
          espejo?.tipoCuenta ?? (link.tipoCuenta as "corriente" | "contado" | null) ?? undefined,
        idPriceList: espejo ? espejo.idPriceList : (link.idPriceList ?? undefined),
        origen: "vinculacion",
      },
      esAdmin: esRolAdmin(user?.publicMetadata),
    };
  }

  // Logueado con Clerk pero sin vincular: si trae cookie del CRM la honramos,
  // así el cliente viejo no pierde sus precios al pasarse a Google.
  const crm = await sesionCrm();
  return {
    clerkUserId: userId,
    email,
    nombre,
    nombrePila: nombrePila({
      firstName: user?.firstName,
      fullName: user?.fullName,
      razonSocial: crm?.razonsocial,
    }),
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
    esAdmin: esRolAdmin(user?.publicMetadata),
  };
});

/**
 * ¿El request lo hace un admin del Shop? Solo Clerk (`publicMetadata.role`),
 * nunca la cookie del CRM. Aparte de `identidadActual()` a propósito: las
 * server actions corren fuera de un render (`cache()` no memoiza ahí, ver
 * más arriba) y no deben pagar la vinculación ni Alegra en cada guardado.
 */
export const esAdmin = cache(async function esAdmin(): Promise<boolean> {
  try {
    const { userId } = await auth();
    if (!userId) return false;
    const user = await currentUser();
    return esRolAdmin(user?.publicMetadata);
  } catch {
    return false;
  }
});

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
 * Lista de precios del cliente, SIN tocar Alegra (0 requests). La usan el
 * carrito y la confirmación del pedido, así que el cliente paga lo que vio.
 *
 * 1. Espejo de contactos del CRM: la lista asignada hoy, si es usable (una
 *    lista dada de baja ⇒ `undefined` = principal, ver `idPriceListUsable`).
 * 2. Sin fila en el espejo (o la vista no responde): el snapshot de
 *    `client_links` que se congeló al vincular.
 * 3. Sin nada → `undefined` = lista principal.
 *
 * No hay control en vivo al confirmar: la tienda respeta sus propios precios
 * (decisión 2026-09-23).
 */
export async function idPriceListCliente(
  codigocliente: string,
): Promise<string | undefined> {
  const espejo = await comercialDelEspejo(codigocliente);
  if (espejo) return espejo.idPriceList;

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

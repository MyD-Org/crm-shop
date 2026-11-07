/**
 * Envío de emails vía Resend. SOLO servidor.
 *
 * Cliente HTTP a mano en vez del SDK, por consistencia con src/lib/alegra.ts:
 * es un POST con un bearer, y una dependencia menos que auditar.
 */

import { getMarca } from "./marca";
import { claveSitio, resolverSitioPorClave, type SitioResuelto } from "./sitio";
import { leerDestinosExtra } from "./sitio-datos";

const API_URL = "https://api.resend.com/emails";

/**
 * Remitente. Resend solo despacha desde un dominio verificado; hasta que
 * `cliente.example` lo esté, `onboarding@resend.dev` funciona pero SOLO
 * entrega al dueño de la cuenta de Resend. Sirve para probar, no para producción.
 *
 * Orden: 1) EMAIL_FROM del proyecto; 2) si el sitio tiene marca propia, su remitente con el nombre
 * de su marca; 3) lo de siempre. Un sitio propio sin remitente ni EMAIL_FROM devuelve null: jamás
 * sale con la dirección ni el nombre de Central.
 */
async function remitente(): Promise<string | null> {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  const sitio = await sitioPropio();
  if (sitio) {
    if (!sitio.remitente) return null;
    return `${(await getMarca()).nombre} <${sitio.remitente}>`;
  }
  // Sin EMAIL_FROM: el remitente de prueba de Resend con el nombre de la tienda (no tira: `getMarca`
  // cae a la marca de entorno).
  return `${(await getMarca()).nombre} <onboarding@resend.dev>`;
}

/** El sitio propio de este despliegue, o null (principal, alias o sin poder leer los extras). */
async function sitioPropio(): Promise<SitioResuelto | null> {
  const clave = claveSitio();
  // Sin sitio en el entorno ni override: es el principal, no hace falta leer los extras.
  if (clave === "|") return null;
  try {
    const sitio = resolverSitioPorClave(clave, await leerDestinosExtra());
    return sitio.propio ? sitio : null;
  } catch (err) {
    console.error(`[email] no se pudieron leer los sitios, uso el remitente de siempre: ${err instanceof Error ? err.message : "desconocido"}`);
    return null;
  }
}

export interface EmailEnviado {
  ok: boolean;
  id?: string;
  error?: string;
  /** true = no salió porque falta `RESEND_API_KEY` (no es una falla del envío). */
  noConfigurado?: boolean;
}

export interface OpcionesEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Default `EMAIL_FROM`. El aviso de comprobantes pasa el suyo. */
  from?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
  /** Tags de Resend: sólo [A-Za-z0-9_-]. */
  tags?: { name: string; value: string }[];
  /** Clave de deduplicación del lado de Resend (header `Idempotency-Key`). */
  idempotencyKey?: string;
  /**
   * Cabeceras propias del mensaje (p. ej. `List-Unsubscribe` y `List-Unsubscribe-Post` en los avisos
   * de reingreso). Resend las suma a las que arma él.
   */
  headers?: Record<string, string>;
}

export async function enviarEmail(opts: OpcionesEmail): Promise<EmailEnviado> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No se tira: quien llama decide si esto es fatal. Un mail de aviso que no
    // sale no debería tumbar un pedido que ya se registró.
    console.error("[email] falta RESEND_API_KEY: no se envió nada");
    return { ok: false, error: "Email no configurado", noConfigurado: true };
  }

  const from = opts.from ?? (await remitente());
  if (!from) {
    // Sitio con marca propia sin remitente: no se usa el de Central. El pedido ya está registrado.
    console.error("[email] el sitio tiene marca propia pero no hay remitente (EMAIL_FROM ni remitente del sitio): no se envió nada");
    return { ok: false, error: "No se pudo enviar el email" };
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(opts.attachments
          ? {
              attachments: opts.attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.content).toString("base64"),
                content_type: a.contentType,
              })),
            }
          : {}),
        ...(opts.tags ? { tags: opts.tags } : {}),
        ...(opts.headers && Object.keys(opts.headers).length ? { headers: opts.headers } : {}),
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      // El detalle de Resend va al log, no al usuario: puede filtrar si una
      // dirección existe o está en la lista de rebotes.
      console.error(`[email] Resend ${res.status}:`, body);
      return { ok: false, error: "No se pudo enviar el email" };
    }

    return { ok: true, id: (body as { id?: string }).id };
  } catch (err) {
    console.error("[email] error de red:", err);
    return { ok: false, error: "No se pudo enviar el email" };
  }
}

/**
 * Enmascara una dirección para poder mostrarla sin revelarla:
 * `juan.perez@empresa.com` → `ju***@empresa.com`.
 *
 * Se muestra para que el cliente reconozca SU casilla y sepa dónde mirar. Si se
 * mostrara entera, el formulario se convertiría en un buscador de emails: metés
 * CUITs y te devuelve la casilla de cada empresa.
 */
export function enmascararEmail(email: string): string {
  const [usuario, dominio] = email.split("@");
  if (!dominio) return "***";
  const visible = usuario.slice(0, Math.min(2, usuario.length));
  return `${visible}***@${dominio}`;
}

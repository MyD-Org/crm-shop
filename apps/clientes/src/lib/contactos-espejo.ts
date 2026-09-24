/**
 * Contactos de Alegra leídos del ESPEJO del CRM (`public.alegra_contacts_shop`).
 * SOLO servidor.
 *
 * Por qué del espejo y no de Alegra en vivo: `/contacts` admite ~5 requests por
 * minuto por cuenta, y la comparten el CRM, el bot y el Shop (un recorrido del
 * padrón ya tiró el login del portal con 429). El espejo lo mantienen la sync y
 * los webhooks del CRM; el Shop sólo lo lee, por la vista y con `shop_app`.
 *
 * `tipoCuenta` sale de la columna generada del CRM (plazo > 0 o límite > 0 ⇒
 * cuenta corriente): acá NO se recalcula.
 *
 * Sin fila activa (contacto recién creado en Alegra que la sync todavía no vio):
 * UNA consulta en vivo por id, con el mismo mapeo. Si también falla, `null` y la
 * sección que lo pidió muestra su aviso de "no pudimos obtener…".
 *
 * Rebanada 3 de `espejo-contactos-alegra` (búsqueda por email/documento para la
 * vinculación) todavía no está: cuando llegue, suma sus lecturas en este módulo.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmContactos } from "@/db/crm";
import { esIdAlegra, getContacto, tipoCuentaDe } from "./alegra";
import { shopTenantId } from "./tenant";

/** Cuenta de Alegra dentro del tenant. Hoy siempre una (ver `alegra_account` en el CRM). */
export const CUENTA_ALEGRA_PRINCIPAL = "principal";

/** Lo que la cuenta corriente necesita saber del contacto. */
export interface ContactoEspejo {
  alegraId: string;
  nombre: string;
  /** CUIT/CUIL/DNI tal como está en Alegra. */
  identificacion: string | null;
  email: string | null;
  tipoCuenta: "corriente" | "contado";
  listaPrecios: string | null;
  vendedor: string | null;
  plazoNombre: string | null;
  plazoDias: number | null;
  /** `null` = no cargado (la UI no muestra la barra de crédito). */
  limiteCredito: number | null;
  /** De dónde salió: el espejo o la consulta en vivo de respaldo. */
  origen: "espejo" | "vivo";
}

function numeroONull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textoONull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

async function delEspejo(alegraId: string): Promise<ContactoEspejo | null> {
  const [fila] = await getDb()
    .select({
      alegraId: crmContactos.alegraId,
      name: crmContactos.name,
      identification: crmContactos.identification,
      email: crmContactos.email,
      tipoCuenta: crmContactos.tipoCuenta,
      priceListName: crmContactos.priceListName,
      sellerName: crmContactos.sellerName,
      paymentTermName: crmContactos.paymentTermName,
      paymentTermDays: crmContactos.paymentTermDays,
      creditLimit: crmContactos.creditLimit,
    })
    .from(crmContactos)
    .where(
      and(
        eq(crmContactos.tenantId, shopTenantId()),
        eq(crmContactos.alegraAccount, CUENTA_ALEGRA_PRINCIPAL),
        eq(crmContactos.alegraId, alegraId),
        // `status` es "visto en la última corrida", no el estado de Alegra: una
        // fila inactiva cuenta como "no está" y va al respaldo en vivo.
        eq(crmContactos.status, "active"),
      ),
    )
    .limit(1);
  if (!fila) return null;
  return {
    alegraId: fila.alegraId,
    nombre: fila.name,
    identificacion: fila.identification,
    email: fila.email,
    tipoCuenta: fila.tipoCuenta === "corriente" ? "corriente" : "contado",
    listaPrecios: fila.priceListName,
    vendedor: fila.sellerName,
    plazoNombre: fila.paymentTermName,
    plazoDias: fila.paymentTermDays,
    limiteCredito: numeroONull(fila.creditLimit),
    origen: "espejo",
  };
}

async function enVivo(alegraId: string): Promise<ContactoEspejo | null> {
  const c = await getContacto(alegraId);
  if (!c || c.id == null) return null;
  const vendedor = (c as { seller?: { name?: unknown } | null }).seller;
  return {
    alegraId: String(c.id),
    nombre: c.name,
    identificacion: textoONull(c.identification),
    email: textoONull(c.email),
    tipoCuenta: tipoCuentaDe(c),
    listaPrecios: textoONull(c.priceList?.name),
    vendedor: textoONull(vendedor?.name),
    plazoNombre: textoONull(c.term?.name),
    plazoDias: numeroONull(c.term?.days),
    limiteCredito: numeroONull(c.creditLimit),
    origen: "vivo",
  };
}

/**
 * Contacto por su id de Alegra (= `codigocliente` de la identidad), del tenant
 * del Shop. Espejo primero; sin fila activa, 1 request en vivo; si falla, `null`.
 */
export async function contactoPorId(alegraId: string): Promise<ContactoEspejo | null> {
  if (!esIdAlegra(alegraId)) return null;
  const espejo = await delEspejo(alegraId);
  if (espejo) return espejo;
  try {
    return await enVivo(alegraId);
  } catch (err) {
    // Sólo el motivo técnico: nunca el cuerpo de Alegra ni datos del contacto.
    const estado = err instanceof Error ? /Alegra (\d{3})/.exec(err.message)?.[1] : undefined;
    console.error(`contactoPorId: respaldo en vivo falló (${estado ?? "sin respuesta"})`);
    return null;
  }
}

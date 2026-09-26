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
 * La vinculación (email y documento) y la lista de precios del cliente también
 * leen de acá (rebanada 3 de `espejo-contactos-alegra`): ver `contactosPorEmail`,
 * `contactoPorDocumento` y `vinculablePorId`. Esas tres NO salen a Alegra: el
 * respaldo en vivo, cuando corresponde, lo decide quien llama.
 */
import { and, arrayContains, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCatalogo, crmContactos } from "@/db/crm";
import {
  esIdAlegra,
  getContacto,
  idPriceListUsable,
  mapPrecios,
  tipoCuentaDe,
  type AlegraContact,
} from "./alegra";
import type { ContactoFacturacion } from "./contacto-alegra";
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

/**
 * ¿El contacto tiene acceso a Facturación de Mi cuenta? SÓLO del espejo (1 query
 * a la vista, nunca Alegra en vivo): lo usa `accesoFacturacion()` en cada página
 * de Mi cuenta, y un respaldo en vivo por navegación gastaría la cuota de
 * `/contacts`. La regla vive en la vista del CRM (0039): `acceso_facturacion` =
 * cuenta corriente O excepción vigente otorgada desde el admin del CRM. Sin fila
 * activa ⇒ `null`; cualquier valor que no sea `true` ⇒ `false` (fail-closed).
 * Lanza si la vista no responde: quien llama decide.
 */
export async function accesoFacturacionEspejo(alegraId: string): Promise<boolean | null> {
  if (!esIdAlegra(alegraId)) return null;
  const [fila] = await getDb()
    .select({ acceso: crmContactos.accesoFacturacion })
    .from(crmContactos)
    .where(
      and(
        eq(crmContactos.tenantId, shopTenantId()),
        eq(crmContactos.alegraAccount, CUENTA_ALEGRA_PRINCIPAL),
        eq(crmContactos.alegraId, alegraId),
        eq(crmContactos.status, "active"),
      ),
    )
    .limit(1);
  if (!fila) return null;
  return fila.acceso === true;
}

// ---------------------------------------------------------------------------
// Vinculación y lista de precios (rebanada 3). Sólo espejo: 0 requests.
// ---------------------------------------------------------------------------

/**
 * Lo que la vinculación y la cotización necesitan de un contacto, venga del
 * espejo o de Alegra en vivo. `tipoCuenta` del espejo es la columna generada del
 * CRM; de un contacto en vivo, `tipoCuentaDe`.
 */
export interface ContactoVinculable {
  id: string;
  name: string;
  identification: string | null;
  email: string | null;
  priceList: { id: string; name: string; status?: string } | null;
  tipoCuenta: "corriente" | "contado";
  types: string[];
  /**
   * ¿Ve Facturación de Mi cuenta? Del espejo, la columna `acceso_facturacion` de
   * la vista (cuenta corriente O excepción del CRM). De un contacto EN VIVO, sólo
   * cuenta corriente: la excepción existe únicamente para contactos del espejo.
   */
  accesoFacturacion: boolean;
}

/** Filas activas del tenant del Shop en la cuenta principal. */
function activasDelShop() {
  return and(
    eq(crmContactos.tenantId, shopTenantId()),
    eq(crmContactos.alegraAccount, CUENTA_ALEGRA_PRINCIPAL),
    eq(crmContactos.status, "active"),
  );
}

const columnasVinculables = {
  alegraId: crmContactos.alegraId,
  name: crmContactos.name,
  identification: crmContactos.identification,
  email: crmContactos.email,
  types: crmContactos.types,
  priceListId: crmContactos.priceListId,
  priceListName: crmContactos.priceListName,
  priceListStatus: crmContactos.priceListStatus,
  tipoCuenta: crmContactos.tipoCuenta,
  // 0039 del CRM (tiene que estar aplicada: el select es explícito).
  accesoFacturacion: crmContactos.accesoFacturacion,
};

type FilaVinculable = {
  alegraId: string;
  name: string;
  identification: string | null;
  email: string | null;
  types: string[] | null;
  priceListId: string | null;
  priceListName: string | null;
  priceListStatus: string | null;
  tipoCuenta: "corriente" | "contado" | null;
  accesoFacturacion: boolean | null;
};

function aVinculable(f: FilaVinculable): ContactoVinculable {
  return {
    id: f.alegraId,
    name: f.name,
    identification: f.identification,
    email: f.email,
    priceList: f.priceListId
      ? {
          id: f.priceListId,
          name: f.priceListName ?? "",
          ...(f.priceListStatus ? { status: f.priceListStatus } : {}),
        }
      : null,
    tipoCuenta: f.tipoCuenta === "corriente" ? "corriente" : "contado",
    types: f.types ?? [],
    accesoFacturacion: f.accesoFacturacion === true,
  };
}

/** Un contacto leído EN VIVO de Alegra, en la misma forma que una fila del espejo. */
export function vinculableDeAlegra(c: AlegraContact): ContactoVinculable {
  const tipoCuenta = tipoCuentaDe(c);
  return {
    id: String(c.id),
    name: c.name,
    identification: textoONull(c.identification),
    email: textoONull(c.email),
    priceList: c.priceList?.id ? { ...c.priceList, id: String(c.priceList.id) } : null,
    tipoCuenta,
    types: Array.isArray(c.type) ? (c.type as string[]) : [],
    // En vivo no hay excepción (vive en el CRM, sólo para contactos del espejo).
    accesoFacturacion: tipoCuenta === "corriente",
  };
}

/**
 * Clientes (`'client' = ANY(types)`) cuya casilla es `email`, comparando contra
 * `emails_norm` (minúsculas, sin espacios, un email por elemento). Sólo espejo.
 * Devuelve todos los que matchean (hasta 5): si hay más de uno, quien llama
 * decide que es ambiguo.
 */
export async function contactosPorEmail(email: string): Promise<ContactoVinculable[]> {
  const norm = email.trim().toLowerCase();
  if (!norm) return [];
  const filas = await getDb()
    .select(columnasVinculables)
    .from(crmContactos)
    .where(
      and(
        activasDelShop(),
        arrayContains(crmContactos.emailsNorm, [norm]),
        arrayContains(crmContactos.types, ["client"]),
      ),
    )
    .orderBy(asc(crmContactos.alegraId))
    .limit(5);
  return filas.map(aVinculable);
}

/**
 * Contacto por documento (CUIT/CUIL/DNI), comparando SÓLO dígitos contra
 * `identification_norm`: "20-12345678-9" y "20123456789" son el mismo. Con más
 * de una fila gana el cliente y después el id numérico menor, siempre el mismo
 * (mismo criterio que el CRM). Sólo espejo.
 */
export async function contactoPorDocumento(documento: string): Promise<ContactoVinculable | null> {
  const digitos = documento.replace(/\D/g, "");
  if (!digitos) return null;
  const [fila] = await getDb()
    .select(columnasVinculables)
    .from(crmContactos)
    .where(and(activasDelShop(), eq(crmContactos.identificationNorm, digitos)))
    .orderBy(
      sql`('client' = ANY(${crmContactos.types})) DESC`,
      sql`CASE WHEN ${crmContactos.alegraId} ~ '^[0-9]+$' THEN ${crmContactos.alegraId}::numeric END ASC NULLS LAST`,
      asc(crmContactos.alegraId),
    )
    .limit(1);
  return fila ? aVinculable(fila) : null;
}

/** Contacto por id de Alegra, SÓLO del espejo (sin respaldo en vivo). */
export async function vinculablePorId(alegraId: string): Promise<ContactoVinculable | null> {
  if (!esIdAlegra(alegraId)) return null;
  const [fila] = await getDb()
    .select(columnasVinculables)
    .from(crmContactos)
    .where(and(activasDelShop(), eq(crmContactos.alegraId, alegraId)))
    .limit(1);
  return fila ? aVinculable(fila) : null;
}

/**
 * Datos comerciales del cliente según el espejo: tipo de cuenta y lista de
 * precios USABLE (una lista dada de baja ⇒ `undefined` = principal). `null` =
 * sin fila activa: quien llama cae al snapshot de `client_links`. 1 query, 0
 * requests a Alegra.
 */
export async function comercialEspejo(
  alegraId: string,
): Promise<{ tipoCuenta: "corriente" | "contado"; idPriceList: string | undefined } | null> {
  const c = await vinculablePorId(alegraId);
  if (!c) return null;
  return { tipoCuenta: c.tipoCuenta, idPriceList: idPriceListUsable(c) };
}

/**
 * ¿Vincular la cuenta le cambia algo a quien compra con el documento de este
 * contacto? Sólo si tiene acceso a Facturación (cuenta corriente o excepción del
 * CRM) o una lista de precios propia distinta de la general. Un cliente de
 * contado del local, a precio de lista, no gana nada vinculando: no se le
 * ofrece. Si el espejo no responde ⇒ false (no se ofrece; comprar a lista está
 * bien). 1–2 queries.
 */
export async function vincularCambiaAlgo(alegraId: string): Promise<boolean> {
  try {
    const c = await vinculablePorId(alegraId);
    if (!c) return false;
    if (c.accesoFacturacion) return true;
    const propia = idPriceListUsable(c);
    if (!propia) return false;
    const general = await idListaGeneral();
    return general !== null && propia !== general;
  } catch (err) {
    console.error(`contactos-espejo: vincularCambiaAlgo caído (${err instanceof Error ? err.name : "desconocido"})`);
    return false;
  }
}

/**
 * Id de la lista de precios GENERAL (la principal: `main` en los precios de
 * Alegra), leída de un ítem activo del espejo de productos del CRM. Es la lista
 * con la que compra quien no vinculó cuenta. `null` = no se pudo saber (sin
 * ítems o la vista no respondió): quien llama decide qué hacer. 1 query.
 */
export async function idListaGeneral(): Promise<string | null> {
  try {
    const [fila] = await getDb()
      .select({ precios: crmCatalogo.preciosAlegra })
      .from(crmCatalogo)
      .where(
        and(
          eq(crmCatalogo.tenantId, shopTenantId()),
          eq(crmCatalogo.activo, true),
          sql`${crmCatalogo.preciosAlegra} @> '[{"main": true}]'::jsonb`,
        ),
      )
      .limit(1);
    return mapPrecios(fila?.precios).find((p) => p.main)?.idPriceList ?? null;
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[contactos] no se pudo leer la lista general (${codigo ?? "sin código"})`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Facturación (change `contacto-fuente-unica`). Sólo espejo: 0 requests.
// ---------------------------------------------------------------------------

/**
 * Datos de facturación del contacto según el espejo (columnas generadas de la
 * 0034 del CRM), o `null` sin fila activa. El respaldo en vivo lo decide
 * `datos-del-contacto.ts`. Lanza si la vista no responde.
 */
export async function facturacionEspejo(alegraId: string): Promise<ContactoFacturacion | null> {
  if (!esIdAlegra(alegraId)) return null;
  const [fila] = await getDb()
    .select({
      alegraId: crmContactos.alegraId,
      name: crmContactos.name,
      identification: crmContactos.identification,
      identificationNorm: crmContactos.identificationNorm,
      identificationType: crmContactos.identificationType,
      identificationNumber: crmContactos.identificationNumber,
      ivaCondition: crmContactos.ivaCondition,
      addressStreet: crmContactos.addressStreet,
      addressCity: crmContactos.addressCity,
      addressProvince: crmContactos.addressProvince,
      addressPostalCode: crmContactos.addressPostalCode,
      // 0036 del CRM: el checkout no vuelve a pedir un teléfono que ya está.
      phonePrimary: crmContactos.phonePrimary,
      phoneSecondary: crmContactos.phoneSecondary,
      mobile: crmContactos.mobile,
    })
    .from(crmContactos)
    .where(and(activasDelShop(), eq(crmContactos.alegraId, alegraId)))
    .limit(1);
  if (!fila) return null;
  // `name` es NOT NULL en la vista, pero un nombre en blanco cuenta como vacío.
  return { ...fila, name: textoONull(fila.name) };
}

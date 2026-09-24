/**
 * Persistencia del perfil de facturación. SOLO servidor.
 *
 * Separado de `facturacion.ts` (puro) para que el formulario pueda importar las
 * validaciones sin arrastrar `postgres` al bundle del cliente.
 */

import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { billingProfiles } from "@/db/schema";
import { contactoPorDocumento } from "./contactos-espejo";
import {
  normalizarDoc,
  telefonoValido,
  validarFacturacion,
  type CondicionIva,
  type DatosFacturacion,
  type Pais,
  type TipoDoc,
} from "./facturacion";

export type PerfilFacturacion = typeof billingProfiles.$inferSelect;

export async function getPerfilFacturacion(
  clerkUserId: string,
): Promise<PerfilFacturacion | null> {
  const [fila] = await getDb()
    .select()
    .from(billingProfiles)
    .where(eq(billingProfiles.clerkUserId, clerkUserId))
    .limit(1);
  return fila ?? null;
}

/**
 * ¿Este documento ya existe como contacto en Alegra?
 *
 * Devuelve el id del contacto, o null. **No vincula nada**: solo alimenta el
 * aviso "parece que ya sos cliente" y la marca de revisión del pedido. Vincular
 * por coincidencia de número sería regalar la cuenta a quien escriba el CUIT.
 *
 * Se consulta SÓLO el espejo de contactos del CRM (0 requests a Alegra, sin
 * respaldo en vivo): es un aviso, y un contacto recién cargado que la sync
 * todavía no vio no justifica gastar la cuota de `/contacts` en cada guardado.
 *
 * Falla en silencio a null: que el espejo no responda no puede impedir que
 * alguien guarde sus datos de facturación.
 */
async function contactoExistenteEnAlegra(nroDoc: string): Promise<string | null> {
  try {
    const contacto = await contactoPorDocumento(nroDoc);
    return contacto?.id ?? null;
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[facturacion] no se pudo consultar el espejo de contactos (${codigo ?? "sin código"})`);
    return null;
  }
}

/** Crea o actualiza el perfil de facturación del usuario. */
export async function guardarPerfilFacturacion(
  clerkUserId: string,
  datos: DatosFacturacion,
): Promise<PerfilFacturacion> {
  const nroDoc = normalizarDoc(datos.tipoDoc, datos.nroDoc);
  const coincideConAlegra = await contactoExistenteEnAlegra(nroDoc);

  const valores = {
    clerkUserId,
    pais: datos.pais,
    tipoDoc: datos.tipoDoc,
    nroDoc,
    razonSocial: datos.razonSocial.trim(),
    // La condición frente al IVA es argentina: a un extranjero no se le
    // pregunta y se le factura como consumidor final.
    condicionIva: datos.pais === "AR" ? datos.condicionIva : "consumidor_final",
    domicilioCalle: datos.domicilioCalle?.trim() || null,
    domicilioCiudad: datos.domicilioCiudad?.trim() || null,
    domicilioProvincia: datos.domicilioProvincia?.trim() || null,
    domicilioCp: datos.domicilioCp?.trim() || null,
    telefono: datos.telefono?.trim() || null,
    coincideConAlegra,
    updatedAt: new Date(),
  };

  const [fila] = await getDb()
    .insert(billingProfiles)
    .values(valores)
    .onConflictDoUpdate({
      target: billingProfiles.clerkUserId,
      set: valores,
    })
    .returning();

  return fila;
}

/**
 * Cambia SOLO el teléfono de contacto. Existe para el perfil vinculado a
 * Alegra, que se muestra en solo lectura: la razón social y el CUIT los manda
 * el sistema, pero el teléfono al que llamar por un pedido sigue siendo del
 * cliente.
 *
 * Sin perfil crea una fila "sólo teléfono" (migración 0009): el vinculado
 * factura con los datos del espejo y no tiene por qué tener perfil (#499).
 */
export async function actualizarTelefono(
  clerkUserId: string,
  telefono: string,
): Promise<PerfilFacturacion> {
  const valor = { telefono: telefono.trim() || null, updatedAt: new Date() };
  const [fila] = await getDb()
    .insert(billingProfiles)
    .values({ clerkUserId, ...valor })
    .onConflictDoUpdate({ target: billingProfiles.clerkUserId, set: valor })
    .returning();
  return fila;
}

/**
 * El perfil aprende el teléfono del primer pedido.
 *
 * Quien cargó sus datos antes de que existiera el campo (o lo dejó vacío) lo
 * tipea igual en el checkout; guardarlo ahí evita pedírselo en cada compra.
 * Solo se completa si el perfil NO tenía uno: el que está cargado es el que
 * el cliente eligió, y un pedido puntual con otro número no lo pisa. Un número
 * que no parece teléfono no se aprende.
 */
export async function guardarTelefonoSiFalta(
  clerkUserId: string,
  telefono: string,
): Promise<void> {
  const limpio = telefono.trim();
  if (!telefonoValido(limpio)) return;
  // Sin perfil (vinculado que factura con el espejo): fila "sólo teléfono".
  const creada = await getDb()
    .insert(billingProfiles)
    .values({ clerkUserId, telefono: limpio })
    .onConflictDoNothing({ target: billingProfiles.clerkUserId })
    .returning({ id: billingProfiles.id });
  if (creada.length > 0) return;
  await getDb()
    .update(billingProfiles)
    .set({ telefono: limpio, updatedAt: new Date() })
    .where(
      and(
        eq(billingProfiles.clerkUserId, clerkUserId),
        isNull(billingProfiles.telefono),
      ),
    );
}

/**
 * Respaldo del comprador vinculado (con Clerk) cuando el PUT a Alegra falla
 * (D-8): se guarda en el perfil lo que tipeó, con el documento y la razón
 * social DEL ESPEJO, así la próxima lectura lo mezcla por D2 (mismo documento).
 * Los demás datos del espejo no se copian: se siguen leyendo de ahí.
 *
 * Si el perfil tenía el mismo documento, sólo se completan esos campos (el
 * teléfono y lo demás quedan). Si tenía otro documento, se reemplaza: ya era
 * ignorado por D2.
 */
export async function upsertRespaldoVinculado(
  clerkUserId: string,
  {
    tipoDoc,
    nroDoc,
    razonSocial,
    complemento,
  }: {
    tipoDoc: string;
    nroDoc: string;
    razonSocial: string | null;
    complemento: Partial<
      Record<
        "razonSocial" | "condicionIva" | "domicilioCalle" | "domicilioCiudad" | "domicilioProvincia" | "domicilioCp",
        string
      >
    >;
  },
): Promise<PerfilFacturacion> {
  const nro = normalizarDoc(tipoDoc as TipoDoc, nroDoc);
  const actual = await getPerfilFacturacion(clerkUserId);
  const mismoDoc =
    actual?.nroDoc != null && normalizarDoc((actual.tipoDoc ?? tipoDoc) as TipoDoc, actual.nroDoc) === nro;
  const tipeado = Object.fromEntries(
    Object.entries(complemento).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
  );
  const base = {
    pais: "AR",
    tipoDoc,
    nroDoc: nro,
    razonSocial: razonSocial ?? complemento.razonSocial ?? null,
    updatedAt: new Date(),
  };
  const valores = mismoDoc
    ? { ...base, ...tipeado }
    : {
        ...base,
        condicionIva: complemento.condicionIva ?? null,
        domicilioCalle: complemento.domicilioCalle ?? null,
        domicilioCiudad: complemento.domicilioCiudad ?? null,
        domicilioProvincia: complemento.domicilioProvincia ?? null,
        domicilioCp: complemento.domicilioCp ?? null,
        coincideConAlegra: null,
      };
  const [fila] = await getDb()
    .insert(billingProfiles)
    .values({ clerkUserId, ...valores })
    .onConflictDoUpdate({ target: billingProfiles.clerkUserId, set: valores })
    .returning();
  return fila;
}

/** ¿Está completo como para poder facturar? */
export function perfilCompleto(perfil: PerfilFacturacion | null): boolean {
  if (!perfil) return false;
  return (
    Object.keys(
      validarFacturacion({
        pais: perfil.pais as Pais,
        tipoDoc: (perfil.tipoDoc ?? undefined) as TipoDoc | undefined,
        nroDoc: perfil.nroDoc ?? undefined,
        razonSocial: perfil.razonSocial ?? undefined,
        condicionIva: (perfil.condicionIva ?? undefined) as CondicionIva | undefined,
        domicilioCalle: perfil.domicilioCalle ?? undefined,
        domicilioCiudad: perfil.domicilioCiudad ?? undefined,
      }),
    ).length === 0
  );
}

/**
 * Otro usuario ya cargó este documento. No es motivo para bloquear (una empresa
 * puede tener dos empleados con cuenta), pero sí para que el operador lo sepa.
 */
export async function documentoUsadoPorOtro(
  clerkUserId: string,
  tipoDoc: TipoDoc,
  nroDoc: string,
): Promise<boolean> {
  const [fila] = await getDb()
    .select({ id: billingProfiles.id })
    .from(billingProfiles)
    .where(
      and(
        eq(billingProfiles.nroDoc, normalizarDoc(tipoDoc, nroDoc)),
        ne(billingProfiles.clerkUserId, clerkUserId),
      ),
    )
    .limit(1);
  return Boolean(fila);
}

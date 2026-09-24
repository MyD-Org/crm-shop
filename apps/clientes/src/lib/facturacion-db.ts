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
 * cliente. Devuelve null si el usuario todavía no tiene perfil.
 */
export async function actualizarTelefono(
  clerkUserId: string,
  telefono: string,
): Promise<PerfilFacturacion | null> {
  const [fila] = await getDb()
    .update(billingProfiles)
    .set({ telefono: telefono.trim() || null, updatedAt: new Date() })
    .where(eq(billingProfiles.clerkUserId, clerkUserId))
    .returning();
  return fila ?? null;
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

/** ¿Está completo como para poder facturar? */
export function perfilCompleto(perfil: PerfilFacturacion | null): boolean {
  if (!perfil) return false;
  return (
    Object.keys(
      validarFacturacion({
        pais: perfil.pais as Pais,
        tipoDoc: perfil.tipoDoc as TipoDoc,
        nroDoc: perfil.nroDoc,
        razonSocial: perfil.razonSocial,
        condicionIva: perfil.condicionIva as CondicionIva,
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

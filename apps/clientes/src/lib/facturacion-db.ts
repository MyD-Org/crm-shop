/**
 * Persistencia del perfil de facturación. SOLO servidor.
 *
 * Separado de `facturacion.ts` (puro) para que el formulario pueda importar las
 * validaciones sin arrastrar `postgres` al bundle del cliente.
 */

import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { billingProfiles } from "@/db/schema";
import { buscarContactoPorIdentificacion } from "./alegra";
import {
  soloDigitos,
  validarFacturacion,
  type CondicionIva,
  type DatosFacturacion,
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
 * Falla en silencio a null: que Alegra esté caído no puede impedir que alguien
 * guarde sus datos de facturación.
 */
async function contactoExistenteEnAlegra(nroDoc: string): Promise<string | null> {
  try {
    const contacto = await buscarContactoPorIdentificacion(nroDoc);
    return contacto?.id != null ? String(contacto.id) : null;
  } catch (err) {
    console.error("[facturacion] no se pudo consultar Alegra:", err);
    return null;
  }
}

/** Crea o actualiza el perfil de facturación del usuario. */
export async function guardarPerfilFacturacion(
  clerkUserId: string,
  datos: DatosFacturacion,
): Promise<PerfilFacturacion> {
  const nroDoc = soloDigitos(datos.nroDoc);
  const coincideConAlegra = await contactoExistenteEnAlegra(nroDoc);

  const valores = {
    clerkUserId,
    tipoDoc: datos.tipoDoc,
    nroDoc,
    razonSocial: datos.razonSocial.trim(),
    condicionIva: datos.condicionIva,
    domicilioCalle: datos.domicilioCalle?.trim() || null,
    domicilioCiudad: datos.domicilioCiudad?.trim() || null,
    domicilioProvincia: datos.domicilioProvincia?.trim() || null,
    domicilioCp: datos.domicilioCp?.trim() || null,
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

/** ¿Está completo como para poder facturar? */
export function perfilCompleto(perfil: PerfilFacturacion | null): boolean {
  if (!perfil) return false;
  return (
    Object.keys(
      validarFacturacion({
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
  nroDoc: string,
): Promise<boolean> {
  const [fila] = await getDb()
    .select({ id: billingProfiles.id })
    .from(billingProfiles)
    .where(
      and(
        eq(billingProfiles.nroDoc, soloDigitos(nroDoc)),
        ne(billingProfiles.clerkUserId, clerkUserId),
      ),
    )
    .limit(1);
  return Boolean(fila);
}

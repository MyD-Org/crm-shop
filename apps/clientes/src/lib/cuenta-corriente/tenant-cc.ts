/**
 * Datos del tenant que usa la cuenta corriente (nombre, WhatsApp, mail de
 * comprobantes). SOLO servidor. Se leen de `public.tenants` (GRANT por columna,
 * migración 0032 de apps/admin) y no de envs: se editan en el backoffice del CRM
 * y una variable se desincronizaría.
 */
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmTenants } from "@/db/crm";
import { shopTenantId } from "../tenant";
import { getMarca } from "../marca";

export interface DatosTenant {
  id: string;
  /**
   * Nombre de la tienda para el cliente: el de la marca del sitio si es propia (Luz Atlántica
   * comparte tenant con Central y no debe decir "Central LED"); si no, el del tenant.
   */
  nombre: string;
  /** Sólo dígitos, listo para `wa.me/<número>`. `null` = sin WhatsApp cargado. */
  whatsapp: string | null;
  /** `null` = sin destino para avisar comprobantes. */
  mailComprobantes: string | null;
}

/** Una consulta por request (`cache`). `null` si el tenant no existe en `public.tenants`. */
export const datosTenant = cache(async function datosTenant(): Promise<DatosTenant | null> {
  const [fila] = await getDb()
    .select({
      id: crmTenants.id,
      name: crmTenants.name,
      whatsappNumber: crmTenants.whatsappNumber,
      receiptsEmail: crmTenants.receiptsEmail,
    })
    .from(crmTenants)
    .where(eq(crmTenants.id, shopTenantId()))
    .limit(1);
  if (!fila) return null;
  // `getMarca` nunca lanza (cae a la marca de entorno); el catch es por las dudas.
  const marca = await getMarca().catch(() => null);
  const nombre = marca && !marca.recursosCentral && marca.nombre.trim() ? marca.nombre.trim() : fila.name;
  const whatsapp = fila.whatsappNumber.replace(/\D/g, "");
  return {
    id: fila.id,
    nombre,
    whatsapp: whatsapp || null,
    mailComprobantes: fila.receiptsEmail.trim() || null,
  };
});

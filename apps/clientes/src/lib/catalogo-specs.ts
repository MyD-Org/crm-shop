import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCatalogSpecs } from "@/db/crm";
import { shopTenantId } from "@/lib/tenant";

// Etiquetas/unidades de la spec proyectada por el CRM (0090), para dibujar claves que el Shop no
// conoce. Mismo criterio que catalogo-atributos-disponibles.ts: si la tabla no está o no hay
// permiso, el Shop sigue sin extras (null) y lo registra una vez; se memoiza 5 min por instancia.
export type FieldSpec = { etiqueta?: string; unidad?: string | null; orden?: number; grupo?: string; tipo?: string };

const TTL_MS = 5 * 60_000;
let cache: { at: number; slug: string; fields: Record<string, FieldSpec> | null } | null = null;
let avisado = false;

/** Sólo tests. */
export function reiniciarSpecs(): void {
  cache = null;
  avisado = false;
}

type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;

export async function fieldsDeSpec(
  slug: string,
  db?: Ejecutor,
  ahora: number = Date.now(),
): Promise<Record<string, FieldSpec> | null> {
  if (cache && cache.slug === slug && ahora - cache.at < TTL_MS) return cache.fields;
  let fields: Record<string, FieldSpec> | null = null;
  try {
    // `getDb()` adentro del try: sin conexión configurada también cae a "sin extras".
    const [fila] = await (db ?? getDb())
      .select({ document: crmCatalogSpecs.document })
      .from(crmCatalogSpecs)
      .where(and(eq(crmCatalogSpecs.tenantId, shopTenantId()), eq(crmCatalogSpecs.slug, slug)))
      .limit(1);
    const f = (fila?.document as { fields?: unknown } | undefined)?.fields;
    fields = f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, FieldSpec>) : null;
  } catch (err) {
    if (!avisado) {
      avisado = true;
      console.warn(`[catalogo] catalog_specs no disponible: ${err instanceof Error ? err.message : "error"}`);
    }
    fields = null;
  }
  cache = { at: ahora, slug, fields };
  return fields;
}

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";

/** Upsert de una sección de home. Llama solo desde la API interna (CRM). */
export async function guardarSeccionHome(
  key: string,
  payload: unknown,
): Promise<{ updatedAt: Date }> {
  const [fila] = await getDb()
    .insert(homeContent)
    .values({ key, payload: payload as Record<string, unknown> })
    .onConflictDoUpdate({
      target: homeContent.key,
      set: { payload: payload as Record<string, unknown>, updatedAt: new Date() },
    })
    .returning({ updatedAt: homeContent.updatedAt });
  return fila;
}

/** Elimina la fila de una sección (vuelve al default). */
export async function borrarSeccionHome(key: string): Promise<void> {
  await getDb().delete(homeContent).where(eq(homeContent.key, key));
}

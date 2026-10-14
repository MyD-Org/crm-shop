import type { MetadataRoute } from "next";
import { getMarca } from "@/lib/marca";
import { manifestDeMarca } from "@/lib/manifest-marca";

/**
 * Manifest PWA básico: nombre y descripción salen de la marca de la tienda (`getMarca`, cacheada).
 * Con la marca de Central es el de siempre (`src/lib/manifest-marca.test.ts`).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return manifestDeMarca(await getMarca());
}

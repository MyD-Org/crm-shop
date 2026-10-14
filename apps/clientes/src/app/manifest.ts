import type { MetadataRoute } from "next";
import { getMarca } from "@/lib/marca";
import { manifestDeMarca } from "@/lib/manifest-marca";
import { coloresPwaDeTema } from "@/lib/tema-tenant";
import { getTemaTenant } from "@/lib/tema-tenant-datos";

/**
 * Manifest PWA básico: nombre y descripción salen de la marca de la tienda (`getMarca`, cacheada).
 * Los colores salen del tema propio del tenant si lo tiene. Con la marca de Central es el de siempre (`src/lib/manifest-marca.test.ts`).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [marca, tema] = await Promise.all([getMarca(), getTemaTenant()]);
  return manifestDeMarca(marca, coloresPwaDeTema(tema));
}

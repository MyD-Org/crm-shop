/**
 * Forma mínima del cliente R2 que consume `home-acciones.ts` (subset de
 * `R2Client`, `apps/admin/src/lib/r2.ts`). Declarada acá para que el stub
 * tipe-check contra el mismo contrato que la rebanada C va a implementar.
 */
interface R2ClientMinimo {
  presignPut(
    key: string,
    opts: { contentType: string; contentLength: number; ttlSeconds: number },
  ): Promise<{ url: string; headers: { "content-type": string } }>;
}

/**
 * Stub: se reemplaza en la rebanada C (home-editable) por el cliente R2
 * portado de `apps/admin/src/lib/shop-media.ts`. Mientras tanto
 * `getShopMediaR2()` siempre devuelve `null`, así
 * `firmarSubidaImagenHome` (`src/lib/home-acciones.ts`) responde "El
 * almacenamiento de imágenes no está configurado" en vez de romper. Las
 * firmas de `homeImagenKey`/`urlPublicaHome` ya son las finales (design-2)
 * para que `home-acciones.ts` tipe-check sin cambios en C.
 */
export function getShopMediaR2(): R2ClientMinimo | null {
  return null;
}

export function homeImagenKey(tenantId: string, id: string, ancho: number): string {
  void tenantId;
  void id;
  void ancho;
  throw new Error("no disponible hasta la rebanada C");
}

export function urlPublicaHome(key: string): string | null {
  void key;
  return null;
}

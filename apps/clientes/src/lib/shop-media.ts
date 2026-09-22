import { createR2, type R2Client, type R2Config } from "./r2";

/**
 * Portado de apps/admin/src/lib/shop-media.ts; candidato a packages/ cuando
 * exista el primer paquete compartido. Env: R2_SHOP_MEDIA_* (par compartido
 * con el CRM, decisión del usuario #392.5).
 *
 * Bucket PÚBLICO `shop-media` (fotos del catálogo del CRM y, desde acá,
 * imágenes de la home del Shop bajo el prefijo `home/{tenant}/`).
 */

const REQUIRED_ENV = ["R2_SHOP_MEDIA_ACCESS_KEY_ID", "R2_SHOP_MEDIA_SECRET_ACCESS_KEY", "R2_SHOP_MEDIA_BUCKET"] as const;

export interface ShopMediaConfig extends R2Config {
  /** Base pública desde donde se sirven las imágenes. SIN barra final. */
  publicUrl: string;
}

let configWarned = false;

/**
 * Las credenciales propias del bucket público, o null si falta alguna.
 *
 * `accountId` y `region` se comparten con el resto de la cuenta (son de la
 * cuenta, no del bucket); lo que NO se comparte es el par de llaves.
 */
export function shopMediaConfig(env: Record<string, string | undefined> = process.env): ShopMediaConfig | null {
  const accountId = env.R2_SHOP_MEDIA_ACCOUNT_ID ?? env.R2_ACCOUNT_ID;
  const publicUrl = env.R2_SHOP_MEDIA_PUBLIC_URL;
  const values = REQUIRED_ENV.map((name) => env[name]);

  if (accountId && publicUrl && values.every((v) => typeof v === "string" && v.length > 0)) {
    const [accessKeyId, secretAccessKey, bucket] = values as [string, string, string];
    return {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      region: env.R2_REGION ?? "auto",
      publicUrl: publicUrl.replace(/\/+$/, ""),
    };
  }

  if (!configWarned) {
    configWarned = true;
    const missing = [
      ...(accountId ? [] : ["R2_SHOP_MEDIA_ACCOUNT_ID o R2_ACCOUNT_ID"]),
      ...(publicUrl ? [] : ["R2_SHOP_MEDIA_PUBLIC_URL"]),
      ...REQUIRED_ENV.filter((name) => !env[name]),
    ];
    console.error(`[shop-media] config incompleta (faltan ${missing.join(", ")}): carga de imágenes de la home deshabilitada`);
  }
  return null;
}

let cached: R2Client | null | undefined;

/** Cliente del bucket público, o null si no está configurado. */
export function getShopMediaR2(): R2Client | null {
  if (cached !== undefined) return cached;
  const cfg = shopMediaConfig();
  cached = cfg ? createR2(cfg) : null;
  return cached;
}

/** Sólo para tests: descarta el cliente memoizado. */
export function resetShopMediaR2(): void {
  cached = undefined;
  configWarned = false;
}

const TENANT_ID_RE = /^[a-z0-9-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ANCHO_IMAGEN_HOME = 1600;

/**
 * Key de una imagen de la home: `home/{tenant}/{uuid}-{ancho}.webp`. Prefijo
 * propio: no pisa `productos/` ni `categorias/` del CRM.
 */
export function homeImagenKey(tenantId: string, id: string, ancho: number = ANCHO_IMAGEN_HOME): string {
  if (!TENANT_ID_RE.test(tenantId)) throw new Error(`tenantId inválido para key de R2: ${JSON.stringify(tenantId)}`);
  if (!UUID_RE.test(id)) throw new Error(`id inválido para key de R2: ${JSON.stringify(id)}`);
  if (ancho !== ANCHO_IMAGEN_HOME) throw new Error(`ancho inválido para key de R2: ${ancho}`);
  return `home/${tenantId}/${id}-${ancho}.webp`;
}

/**
 * Base pública de las imágenes, o null.
 *
 * Aparte de `shopMediaConfig()` A PROPÓSITO: para COMPONER una url sólo hace
 * falta el dominio, no las credenciales.
 */
export function basePublicaMedios(env: Record<string, string | undefined> = process.env): string | null {
  const base = env.R2_SHOP_MEDIA_PUBLIC_URL?.trim();
  return base ? base.replace(/\/+$/, "") : null;
}

export function urlPublicaHome(key: string, base: string | null = basePublicaMedios()): string | null {
  return base ? `${base}/${key}` : null;
}

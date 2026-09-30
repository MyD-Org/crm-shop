/**
 * Config de las herramientas de tracking del Shop, por entorno (repo público:
 * ningún ID en el código). Cada proveedor se activa sólo si su variable está y
 * tiene la forma esperada; una variable mal cargada apaga ese proveedor en vez
 * de inyectar basura en un <script>.
 *
 * Vercel Web Analytics y Speed Insights no llevan ID: se activan en el
 * proyecto de Vercel y van siempre que el flag `tracking` esté prendido.
 *
 * Módulo PURO y sin alias `@/`: lo importa next.config.ts (rewrite de PostHog).
 */

/** Variables que alimentan la config. Se inyectan para poder testear. */
export interface EnvTracking {
  META_PIXEL_ID?: string;
  GA4_MEASUREMENT_ID?: string;
  POSTHOG_KEY?: string;
  /** `us` (default) o `eu`: la región del proyecto de PostHog. */
  POSTHOG_REGION?: string;
}

export interface ConfigPosthog {
  key: string;
  /** Host de la app de PostHog (links de la toolbar); la ingesta va por `/ingest`. */
  uiHost: string;
}

export interface ConfigTracking {
  metaPixelId: string | null;
  ga4Id: string | null;
  posthog: ConfigPosthog | null;
}

/** Hosts de PostHog Cloud por región: ingesta, assets (SDK y recorder) y app. */
export function hostsPosthog(region: string | undefined) {
  const r = region?.trim().toLowerCase() === "eu" ? "eu" : "us";
  return {
    ingesta: `https://${r}.i.posthog.com`,
    assets: `https://${r}-assets.i.posthog.com`,
    ui: `https://${r}.posthog.com`,
  };
}

/** Prefijo del proxy de PostHog en el mismo origen (rewrite en next.config.ts). */
export const RUTA_INGESTA_POSTHOG = "/ingest";

function valida(valor: string | undefined, forma: RegExp): string | null {
  const v = valor?.trim();
  return v && forma.test(v) ? v : null;
}

export function configTracking(env: EnvTracking = process.env as EnvTracking): ConfigTracking {
  const key = valida(env.POSTHOG_KEY, /^phc_[A-Za-z0-9]+$/);
  return {
    metaPixelId: valida(env.META_PIXEL_ID, /^\d{6,20}$/),
    ga4Id: valida(env.GA4_MEASUREMENT_ID, /^G-[A-Z0-9]{4,20}$/),
    posthog: key ? { key, uiHost: hostsPosthog(env.POSTHOG_REGION).ui } : null,
  };
}

/**
 * Rewrites del proxy de PostHog (`/ingest/*` → PostHog Cloud). Van por el
 * mismo origen para que la CSP no sume hosts y los bloqueadores de anuncios
 * corten menos. Sin `POSTHOG_KEY` no hay regla. Orden: los assets primero.
 */
export function rewritesPosthog(env: EnvTracking = process.env as EnvTracking) {
  if (!configTracking(env).posthog) return [];
  const h = hostsPosthog(env.POSTHOG_REGION);
  return [
    { source: `${RUTA_INGESTA_POSTHOG}/static/:path*`, destination: `${h.assets}/static/:path*` },
    { source: `${RUTA_INGESTA_POSTHOG}/array/:path*`, destination: `${h.assets}/array/:path*` },
    { source: `${RUTA_INGESTA_POSTHOG}/:path*`, destination: `${h.ingesta}/:path*` },
  ];
}

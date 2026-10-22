/**
 * Redirección a un perfil de Instagram que deja registrada la visita (`/ig/<cuenta>`).
 *
 * Existe para los QR impresos: Instagram no muestra con qué parámetros entró la gente, así que
 * un UTM pegado al link del perfil no mide nada. El QR apunta a la tienda, la tienda manda un
 * evento a PostHog con los UTM y recién ahí redirige al perfil.
 *
 * Sólo redirige a instagram.com: el destino se arma con un usuario validado, nunca con una URL
 * que venga en la consulta (no es un redireccionador abierto).
 *
 * Módulo PURO: la ruta (src/app/ig/[cuenta]/route.ts) hace el fetch.
 */

/** Usuario de Instagram: letras, números, punto y guion bajo, hasta 30. */
const FORMA_CUENTA = /^[A-Za-z0-9._]{1,30}$/;

export function cuentaValida(cuenta: string): boolean {
  return FORMA_CUENTA.test(cuenta);
}

export function urlPerfil(cuenta: string): string {
  return `https://www.instagram.com/${cuenta}/`;
}

export const EVENTO_REDIRECCION = "redireccion_instagram";

/** Los `utm_*` de la consulta (sin otros parámetros), con un tope de largo por las dudas. */
export function utmDe(params: URLSearchParams): Record<string, string> {
  const utm: Record<string, string> = {};
  for (const [k, v] of params) {
    if (/^utm_[a-z]{1,20}$/.test(k) && v) utm[k] = v.slice(0, 100);
  }
  return utm;
}

/**
 * Cuerpo del evento para la API de captura de PostHog. Visitante anónimo, sin perfil de persona
 * (igual que el cliente: `person_profiles: "identified_only"`).
 */
export function eventoPosthog(opts: {
  key: string;
  distinctId: string;
  origen: string;
  cuenta: string;
  params: URLSearchParams;
}) {
  const utm = utmDe(opts.params);
  const query = new URLSearchParams(utm).toString();
  return {
    api_key: opts.key,
    event: EVENTO_REDIRECCION,
    distinct_id: opts.distinctId,
    properties: {
      ...utm,
      cuenta_instagram: opts.cuenta,
      $current_url: `${opts.origen}/ig/${opts.cuenta}${query ? `?${query}` : ""}`,
      $process_person_profile: false,
    },
  };
}

/**
 * Verificación de Cloudflare Turnstile del lado del servidor (change `compra-como-invitado`, S2a).
 * SOLO servidor.
 *
 * El navegador resuelve el desafío y manda el token; acá se valida con `siteverify` usando
 * `TURNSTILE_SECRET_KEY`. Falla CERRADA: sin secreto, sin token, con la red caída, con un timeout o
 * con cualquier respuesta que no sea un éxito explícito, el resultado es "no ok" y la compra del
 * invitado se rechaza. El token es de un solo uso (Cloudflare lo invalida al verificarlo).
 *
 * La IP viaja como `remoteip` (opcional para Cloudflare, pero ata el token a quien lo resolvió).
 * El secreto nunca se loguea; los logs llevan sólo el motivo.
 */
const URL_VERIFICACION = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 4_000;
/** Cloudflare documenta un máximo de 2048 caracteres por token. */
const LARGO_MAXIMO_TOKEN = 2048;

export type ResultadoTurnstile =
  | { ok: true }
  | { ok: false; motivo: "no_configurado" | "sin_token" | "rechazado" | "error_red" };

export function turnstileConfigurado(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export async function verificarTurnstile(
  token: unknown,
  ip: string | null,
  /** Inyectable para tests. */
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoTurnstile> {
  const secreto = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secreto) return { ok: false, motivo: "no_configurado" };
  if (typeof token !== "string" || token.length === 0 || token.length > LARGO_MAXIMO_TOKEN) {
    return { ok: false, motivo: "sin_token" };
  }

  const cuerpo = new URLSearchParams({ secret: secreto, response: token });
  if (ip) cuerpo.set("remoteip", ip);

  try {
    const r = await fetchFn(URL_VERIFICACION, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!r.ok) {
      console.error(`[turnstile] siteverify respondió ${r.status}`);
      return { ok: false, motivo: "error_red" };
    }
    const datos = (await r.json()) as { success?: unknown };
    return datos.success === true ? { ok: true } : { ok: false, motivo: "rechazado" };
  } catch {
    console.error("[turnstile] no se pudo consultar siteverify");
    return { ok: false, motivo: "error_red" };
  }
}

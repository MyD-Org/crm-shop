import { NextResponse, after, type NextRequest } from "next/server";
import { trackingActivo } from "@/lib/tracking-flag";
import { hostsPosthog } from "@/lib/tracking/config";
import { cuentaValida, eventoPosthog, urlPerfil } from "@/lib/redireccion-instagram";

/**
 * `/ig/<cuenta>?utm_source=qr…`: registra la visita en PostHog y redirige al perfil de Instagram.
 * Ver src/lib/redireccion-instagram.ts. Con el flag `tracking` apagado sólo redirige.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ cuenta: string }> }) {
  const { cuenta } = await ctx.params;
  if (!cuentaValida(cuenta)) return new NextResponse(null, { status: 404 });

  const config = await trackingActivo();
  const posthog = config?.posthog;
  if (posthog) {
    const cuerpo = eventoPosthog({
      key: posthog.key,
      distinctId: crypto.randomUUID(),
      origen: request.nextUrl.origin,
      cuenta,
      params: request.nextUrl.searchParams,
    });
    // Después de responder: la redirección no espera a PostHog, y si PostHog falla no pasa nada.
    after(() =>
      fetch(`${hostsPosthog(process.env.POSTHOG_REGION).ingesta}/i/v0/e/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      }).then(
        () => undefined,
        () => undefined,
      ),
    );
  }

  const res = NextResponse.redirect(urlPerfil(cuenta), 302);
  // Cada escaneo tiene que pasar por acá: si un navegador guardara la redirección, no se contaría.
  res.headers.set("Cache-Control", "no-store");
  return res;
}

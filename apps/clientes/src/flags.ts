import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

/**
 * Flags del Shop en Vercel Flags: se prenden y apagan desde el dashboard (o
 * `vercel flags enable|disable <key> --environment production`) sin redeploy.
 *
 * Se evalúan sólo en el server. `defaultValue: false` es lo que se sirve si
 * Vercel Flags no responde o el flag se archiva: los tres fallan hacia apagado.
 *
 * Nadie los llama directo: cada uno tiene su módulo en src/lib/*-flag.ts con la
 * explicación de qué cambia prendido/apagado, y los tests mockean ese módulo.
 */

export const pagosFlag = flag<boolean>({
  key: "pagos",
  description: "Medios de pago en el checkout (apagado: solo 'a coordinar', sin cobros)",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const cuotasFlag = flag<boolean>({
  key: "cuotas",
  description: "Muestra cuotas y limita el Brick de Mercado Pago a la oferta vigente",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const catalogoSoloVisiblesFlag = flag<boolean>({
  key: "catalogo-solo-visibles",
  description:
    "Listados públicos solo con productos visibles en el overlay del CRM (fail-closed: sin curaduría, tienda vacía)",
  defaultValue: false,
  adapter: vercelAdapter,
});

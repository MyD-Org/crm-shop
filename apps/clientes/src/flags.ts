import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

/**
 * Flags del Shop en Vercel Flags: se prenden y apagan desde el dashboard (o
 * `vercel flags enable|disable <key> --environment production`) sin redeploy.
 *
 * Se evalúan sólo en el server. `defaultValue: false` es lo que se sirve si
 * Vercel Flags no responde o el flag se archiva: todos fallan hacia apagado.
 *
 * Nadie los llama directo: cada uno tiene su módulo en src/lib/*-flag.ts con la
 * explicación de qué cambia prendido/apagado, y los tests mockean ese módulo.
 */

export const cuotasCobroFlag = flag<boolean>({
  key: "cuotas-cobro",
  description:
    "Cuotas sin interés por lista de precios: se exhiben (card, ficha, modal), el checkout ofrece el selector y el cobro con Mercado Pago se congela y valida por cantidad de cuotas. Apagado: nada de cuotas en la tienda y el cobro como siempre",
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

export const sucursalesFlag = flag<boolean>({
  key: "sucursales",
  description: "Sucursales y zonas: el checkout asigna la sucursal al pedido y se muestra el selector de zona",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const disponibilidadSucursalFlag = flag<boolean>({
  key: "disponibilidad-sucursal",
  description:
    "Disponibilidad y reserva por sucursal: stock por local, retiro con demora, envío con respaldo y productos ocultos por sucursal (requiere el flag sucursales)",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const chatIaFlag = flag<boolean>({
  key: "chat-ia",
  description: "Burbuja del chat con el agente en todas las páginas del Shop",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const busquedaIaFlag = flag<boolean>({
  key: "busqueda-ia",
  description:
    "Búsqueda inteligente del catálogo: interpreta búsquedas en lenguaje natural en filtros (determinista + Jev), franja 'Entendimos' y guía del buscador",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const trackingFlag = flag<boolean>({
  key: "tracking",
  description: "Analítica y píxeles (Vercel Analytics, Speed Insights, Meta Pixel, GA4, PostHog) en todas las páginas del Shop",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const precioEspecialCuentaFlag = flag<boolean>({
  key: "precio-especial-cuenta",
  description:
    "Precio especial de la cuenta (lista propia del cliente, #219). Apagado: el precio depende solo del medio de pago elegido; prendido: se restaura la lista del cliente y se ignora la del medio",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const busquedaMedidasFlag = flag<boolean>({
  key: "busqueda-medidas",
  description:
    "Búsqueda por medidas: la consulta ('termica 2x20', 'lampara 9w e27') suma filtros y orden por medida técnica al plan. Apagado: la búsqueda queda como antes (sin ids de medida)",
  defaultValue: false,
  adapter: vercelAdapter,
});

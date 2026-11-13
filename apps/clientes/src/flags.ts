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

export const variantesSelectorFlag = flag<boolean>({
  key: "variantes-selector",
  description:
    "Productos con variantes (color, medida): el catálogo muestra una sola card por modelo (el representante) y lee el overlay del ancla del grupo. Apagado: una card por variante, como siempre (el padre nunca se vende)",
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

export const avisoReingresoFlag = flag<boolean>({
  key: "aviso-reingreso",
  description:
    "Aviso de reingreso: en la ficha de un producto agotado se ofrece 'Avisarme cuando ingrese' y el cron manda un mail al volver a haber disponible. Apagado: la ficha muestra solo 'Sin stock' y el cron no envía. La baja desde el mail sigue funcionando",
  defaultValue: false,
  adapter: vercelAdapter,
});

export const compraInvitadoFlag = flag<boolean>({
  key: "compra-invitado",
  description:
    "Compra como invitado: un anónimo puede completar el checkout sin cuenta (email, teléfono, entrega y facturación) con un token firmado de pocas horas, sin guardar nada en el navegador. Apagado: /checkout lleva a ingresar y los endpoints del pedido no aceptan invitados, como siempre. No afecta al link «Pagar su pedido» de los mails",
  defaultValue: false,
  adapter: vercelAdapter,
});

/** Quién compra, para las reglas de Vercel Flags (`user.id`, `user.email`). Vacío = visitante. */
export interface EntidadesComprador {
  user?: { id: string; email?: string };
}

export const mercadopagoFlag = flag<boolean, EntidadesComprador>({
  key: "mercadopago",
  description:
    "Mercado Pago en el checkout. Con una regla por user.email o user.id se prende sólo para esos compradores (pruebas en producción); prendido para todos = lanzamiento. Apagado: el medio no se ofrece ni se acepta aunque esté activo en el admin",
  defaultValue: false,
  adapter: vercelAdapter,
  async identify() {
    // Import diferido: los flags que no identifican no cargan Clerk.
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return {};
    const user = await currentUser();
    return { user: { id: userId, email: user?.primaryEmailAddress?.emailAddress } };
  },
});

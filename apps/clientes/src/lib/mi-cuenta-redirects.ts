/**
 * Redirects de las URLs viejas de Mi cuenta a las rutas por sección.
 *
 * - `/mi-cuenta?tab=datos` → `/mi-cuenta/datos`, temporal (307). Cualquier
 *   otra pestaña (`compras`, vacía, desconocida) no redirige: muestra el
 *   resumen. Next pasa la query al destino (`/mi-cuenta/datos?tab=datos`), que
 *   la ignora.
 * - `/mi-cuenta/pedido/:id` → `/mi-cuenta/pedidos/:id`, permanente (308), sin
 *   consultar la base: el dueño se valida en el destino.
 * - `/mi-cuenta/envios` → `/mi-cuenta/direcciones`, permanente (308): Envíos y
 *   retiro se unió a Direcciones en una sola sección.
 *
 * Los activa `next.config.ts` (`redirects`). Import relativo y sin alias `@/`
 * porque lo importa `next.config.ts`.
 */
import { hrefPedido, RUTAS_MI_CUENTA } from "./mi-cuenta-nav";

interface RedirectMiCuenta {
  source: string;
  destination: string;
  permanent: boolean;
  has?: { type: "query"; key: string; value: string }[];
}

export const REDIRECTS_MI_CUENTA: readonly RedirectMiCuenta[] = [
  {
    source: RUTAS_MI_CUENTA.resumen,
    has: [{ type: "query", key: "tab", value: "datos" }],
    destination: RUTAS_MI_CUENTA.datos,
    permanent: false,
  },
  {
    source: "/mi-cuenta/pedido/:id",
    destination: hrefPedido(":id"),
    permanent: true,
  },
  {
    source: "/mi-cuenta/envios",
    destination: RUTAS_MI_CUENTA.direcciones,
    permanent: true,
  },
];

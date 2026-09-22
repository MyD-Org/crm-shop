/**
 * Navegación de Mi cuenta: rutas, secciones visibles por identidad y por
 * despliegue, sección activa y migas. Módulo PURO (sin `next/*`, sin DOM, sin
 * alias `@/`): lo importa también `mi-cuenta-redirects.ts`, que termina en
 * `next.config.ts`.
 *
 * La UI no decide visibilidad por su cuenta: el shell pinta lo que devuelve
 * `seccionesVisibles`.
 */

/** Rutas de Mi cuenta. Cada sección es una página propia. */
export const RUTAS_MI_CUENTA = {
  resumen: "/mi-cuenta",
  pedidos: "/mi-cuenta/pedidos",
  facturas: "/mi-cuenta/facturas",
  favoritos: "/mi-cuenta/favoritos",
  direcciones: "/mi-cuenta/direcciones",
  envios: "/mi-cuenta/envios",
  datos: "/mi-cuenta/datos",
  vincular: "/mi-cuenta/vincular",
} as const;

/**
 * Detalle de un pedido. Sin `encodeURIComponent` a propósito: los ids son
 * uuid, y el redirect de la URL vieja arma el destino con `hrefPedido(":id")`.
 */
export const hrefPedido = (id: string) => `${RUTAS_MI_CUENTA.pedidos}/${id}`;

/**
 * Qué secciones ya existen en este despliegue. Cada rebanada que publica una
 * ruta prende su capacidad (favoritos → D, facturas → E); mientras esté en
 * false, la entrada no aparece ni en la navegación ni en el menú del header.
 */
export interface CapacidadesDespliegue {
  favoritos: boolean;
  facturas: boolean;
}

export const CAPACIDADES_DESPLIEGUE: Readonly<CapacidadesDespliegue> = {
  favoritos: true,
  facturas: false,
};

/** Lo que la identidad habilita. */
export interface Capacidades {
  /** Hay sesión de Clerk (dónde guardar favoritos y perfil, sesión que cerrar). */
  clerk: boolean;
  /** Hay cuenta de cliente (contacto de Alegra) vinculada o heredada del CRM. */
  vinculado: boolean;
}

/** Forma mínima de `Identidad` (auth.ts), sin importarla: este módulo es puro. */
interface IdentidadMinima {
  clerkUserId: string | null;
  cliente: { codigocliente?: string } | null;
}

export function capacidadesDe(i: IdentidadMinima): Capacidades {
  return { clerk: !!i.clerkUserId, vinculado: !!i.cliente?.codigocliente };
}

export type IdSeccion =
  | "pedidos"
  | "facturas"
  | "favoritos"
  | "direcciones"
  | "envios"
  | "datos"
  | "seguridad"
  | "salir";

export interface SeccionMiCuenta {
  id: IdSeccion;
  label: string;
  /** Sin href = acción del shell (Seguridad abre Clerk, Cerrar sesión). */
  href?: string;
  tone?: "danger";
}

interface DefinicionSeccion extends SeccionMiCuenta {
  visible: (c: Capacidades, d: CapacidadesDespliegue) => boolean;
}

/** En el orden del mockup. Cookie del CRM sin Clerk: Pedidos, Facturas, Envíos. */
const SECCIONES: readonly DefinicionSeccion[] = [
  { id: "pedidos", label: "Pedidos", href: RUTAS_MI_CUENTA.pedidos, visible: () => true },
  // Sin vínculo también se ve: la página ofrece vincular la cuenta.
  { id: "facturas", label: "Facturas", href: RUTAS_MI_CUENTA.facturas, visible: (_, d) => d.facturas },
  {
    id: "favoritos",
    label: "Favoritos",
    href: RUTAS_MI_CUENTA.favoritos,
    visible: (c, d) => c.clerk && d.favoritos,
  },
  { id: "direcciones", label: "Direcciones", href: RUTAS_MI_CUENTA.direcciones, visible: (c) => c.clerk },
  { id: "envios", label: "Envíos y retiro", href: RUTAS_MI_CUENTA.envios, visible: () => true },
  { id: "datos", label: "Mis datos", href: RUTAS_MI_CUENTA.datos, visible: (c) => c.clerk },
  { id: "seguridad", label: "Seguridad", visible: (c) => c.clerk },
  { id: "salir", label: "Cerrar sesión", tone: "danger", visible: (c) => c.clerk },
];

export function seccionesVisibles(
  c: Capacidades,
  despliegue: CapacidadesDespliegue = CAPACIDADES_DESPLIEGUE,
): SeccionMiCuenta[] {
  return SECCIONES.filter((s) => s.visible(c, despliegue)).map((s) => ({
    id: s.id,
    label: s.label,
    ...(s.href ? { href: s.href } : {}),
    ...(s.tone ? { tone: s.tone } : {}),
  }));
}

/** Segmento de Mi cuenta de un pathname ("" = resumen), sin query ni barra final. */
function segmento(pathname: string): { seccion: string; resto: string[] } {
  const limpio = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  const partes = limpio.split("/").filter(Boolean);
  // partes[0] es "mi-cuenta".
  return { seccion: partes[1] ?? "", resto: partes.slice(2) };
}

/** Sección que se marca activa para un pathname. Las acciones nunca lo son. */
export function seccionActiva(pathname: string): IdSeccion {
  const { seccion } = segmento(pathname);
  switch (seccion) {
    case "facturas":
    case "favoritos":
    case "direcciones":
    case "envios":
    case "datos":
      return seccion;
    case "vincular":
      return "datos";
    default:
      // Resumen, pedidos y detalle, o una ruta desconocida.
      return "pedidos";
  }
}

export interface Miga {
  label: string;
  /** Sin href = página actual (el Breadcrumb le pone `aria-current`). */
  href?: string;
}

const LABEL_SECCION: Record<string, string> = {
  pedidos: "Pedidos",
  facturas: "Facturas",
  favoritos: "Favoritos",
  direcciones: "Direcciones",
  envios: "Envíos y retiro",
  datos: "Mis datos",
};

/**
 * Migas de Mi cuenta para un pathname. En el detalle de un pedido "Pedidos"
 * queda como enlace y el número lo agrega quien tiene el pedido cargado.
 */
export function migasMiCuenta(pathname: string): Miga[] {
  const inicio: Miga = { label: "Inicio", href: "/" };
  const { seccion, resto } = segmento(pathname);

  if (seccion === "vincular") {
    return [
      inicio,
      { label: "Mi cuenta", href: RUTAS_MI_CUENTA.resumen },
      { label: "Mis datos", href: RUTAS_MI_CUENTA.datos },
      { label: "Vincule su cuenta de cliente" },
    ];
  }

  const label = LABEL_SECCION[seccion];
  if (!label) return [inicio, { label: "Mi cuenta" }];

  const miCuenta: Miga = { label: "Mi cuenta", href: RUTAS_MI_CUENTA.resumen };
  if (seccion === "pedidos" && resto.length > 0) {
    return [inicio, miCuenta, { label, href: RUTAS_MI_CUENTA.pedidos }];
  }
  return [inicio, miCuenta, { label }];
}

/**
 * Bajada del saludo de Mi cuenta. Sólo menciona las facturas cuando su
 * sección está desplegada: no se promete algo que el visitante no encuentra.
 */
export function bajadaMiCuenta(
  despliegue: CapacidadesDespliegue = CAPACIDADES_DESPLIEGUE,
): string {
  return despliegue.facturas
    ? "Revise el estado de sus pedidos, descargue facturas y repita compras con un clic."
    : "Revise el estado de sus pedidos y repita compras con un clic.";
}

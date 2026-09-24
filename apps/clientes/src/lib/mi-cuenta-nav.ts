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
  pagos: "/mi-cuenta/pagos",
  presupuestos: "/mi-cuenta/presupuestos",
  condiciones: "/mi-cuenta/condiciones",
  avisos: "/mi-cuenta/avisos",
  favoritos: "/mi-cuenta/favoritos",
  direcciones: "/mi-cuenta/direcciones",
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
 * ruta prende su capacidad (favoritos → D; facturas, pagos, presupuestos,
 * condiciones y avisos → portal-al-shop); mientras esté en false, la entrada
 * no aparece ni en la navegación ni en el menú del header, y la ruta da 404.
 */
export interface CapacidadesDespliegue {
  favoritos: boolean;
  /** "Facturas y saldo" (portal-al-shop, rebanada 1). */
  facturas: boolean;
  /** Direcciones y envíos: sólo con el flag `envio` prendido (src/lib/envio-flag.ts). */
  direcciones: boolean;
  pagos: boolean;
  presupuestos: boolean;
  /** Condiciones comerciales: además, sólo cuenta corriente (`Capacidades.esCuentaCorriente`). */
  condiciones: boolean;
  avisos: boolean;
}

export const CAPACIDADES_DESPLIEGUE: Readonly<CapacidadesDespliegue> = {
  favoritos: true,
  facturas: true,
  direcciones: true,
  pagos: true,
  presupuestos: true,
  condiciones: true,
  avisos: true,
};

/** Lo que la identidad habilita. */
export interface Capacidades {
  /** Hay sesión de Clerk (dónde guardar favoritos y perfil, sesión que cerrar). */
  clerk: boolean;
  /** Hay cuenta de cliente (contacto de Alegra) vinculada o heredada del CRM. */
  vinculado: boolean;
  /**
   * El contacto es cuenta corriente según el espejo del CRM (`tipo_cuenta`,
   * plazo > 0 o límite > 0). Sólo decide Condiciones: el resto de Facturación
   * lo ve todo vinculado, contado incluido.
   */
  esCuentaCorriente: boolean;
}

/** Forma mínima de `Identidad` (auth.ts), sin importarla: este módulo es puro. */
interface IdentidadMinima {
  clerkUserId: string | null;
  cliente: { codigocliente?: string } | null;
}

/**
 * `esCuentaCorriente` lo calcula quien llama con el espejo (`contactoPorId`):
 * este módulo es puro. Sin vínculo nunca es cuenta corriente.
 */
export function capacidadesDe(i: IdentidadMinima, esCuentaCorriente = false): Capacidades {
  const vinculado = !!i.cliente?.codigocliente;
  return { clerk: !!i.clerkUserId, vinculado, esCuentaCorriente: vinculado && esCuentaCorriente };
}

export type IdSeccion =
  | "pedidos"
  | "facturas"
  | "pagos"
  | "presupuestos"
  | "condiciones"
  | "avisos"
  | "favoritos"
  | "direcciones"
  | "datos"
  | "seguridad"
  | "salir";

/** Grupos del menú (decisión "menú agrupado"). Cerrar sesión va suelto, al final. */
export type IdGrupo = "compras" | "facturacion" | "perfil";

/**
 * Títulos de los grupos. "Facturación" y no "Cuenta corriente": el grupo lo ven
 * también los clientes de contado.
 */
export const GRUPOS_MI_CUENTA: readonly { id: IdGrupo; label: string }[] = [
  { id: "compras", label: "Compras online" },
  { id: "facturacion", label: "Facturación" },
  { id: "perfil", label: "Mi perfil" },
];

export interface SeccionMiCuenta {
  id: IdSeccion;
  label: string;
  /** Sin href = acción del shell (Seguridad abre Clerk, Cerrar sesión). */
  href?: string;
  tone?: "danger";
  /** Sin grupo = ítem suelto después de los grupos (Cerrar sesión). */
  grupo?: IdGrupo;
  /** Contador (avisos sin leer). Ausente o 0 = sin badge. */
  badge?: number;
}

interface DefinicionSeccion extends SeccionMiCuenta {
  visible: (c: Capacidades, d: CapacidadesDespliegue) => boolean;
}

/**
 * En el orden del menú agrupado: Compras online (Pedidos, Favoritos) ·
 * Facturación (Facturas y saldo, Pagos, Presupuestos, Condiciones, Avisos) ·
 * Mi perfil (Mis datos, Direcciones y envíos, Seguridad) · Cerrar sesión.
 * Cookie del CRM sin Clerk: Pedidos, Facturación y Direcciones y envíos (la
 * página muestra las reglas de envío; el domicilio fiscal sólo con Clerk).
 */
const SECCIONES: readonly DefinicionSeccion[] = [
  { id: "pedidos", label: "Pedidos", grupo: "compras", href: RUTAS_MI_CUENTA.pedidos, visible: () => true },
  {
    id: "favoritos",
    label: "Favoritos",
    grupo: "compras",
    href: RUTAS_MI_CUENTA.favoritos,
    visible: (c, d) => c.clerk && d.favoritos,
  },
  // Sin vínculo también se ve: la página ofrece vincular la cuenta.
  {
    id: "facturas",
    label: "Facturas y saldo",
    grupo: "facturacion",
    href: RUTAS_MI_CUENTA.facturas,
    visible: (_, d) => d.facturas,
  },
  {
    id: "pagos",
    label: "Pagos",
    grupo: "facturacion",
    href: RUTAS_MI_CUENTA.pagos,
    visible: (c, d) => c.vinculado && d.pagos,
  },
  {
    id: "presupuestos",
    label: "Presupuestos",
    grupo: "facturacion",
    href: RUTAS_MI_CUENTA.presupuestos,
    visible: (c, d) => c.vinculado && d.presupuestos,
  },
  {
    id: "condiciones",
    label: "Condiciones",
    grupo: "facturacion",
    href: RUTAS_MI_CUENTA.condiciones,
    visible: (c, d) => c.vinculado && c.esCuentaCorriente && d.condiciones,
  },
  {
    id: "avisos",
    label: "Avisos",
    grupo: "facturacion",
    href: RUTAS_MI_CUENTA.avisos,
    visible: (c, d) => c.vinculado && d.avisos,
  },
  { id: "datos", label: "Mis datos", grupo: "perfil", href: RUTAS_MI_CUENTA.datos, visible: (c) => c.clerk },
  {
    id: "direcciones",
    label: "Direcciones y envíos",
    grupo: "perfil",
    href: RUTAS_MI_CUENTA.direcciones,
    visible: (_, d) => d.direcciones,
  },
  { id: "seguridad", label: "Seguridad", grupo: "perfil", visible: (c) => c.clerk },
  { id: "salir", label: "Cerrar sesión", tone: "danger", visible: (c) => c.clerk },
];

/**
 * Secciones visibles, en orden. `badges`: contadores por sección (hoy sólo
 * Avisos); un 0 no se pasa.
 */
export function seccionesVisibles(
  c: Capacidades,
  despliegue: CapacidadesDespliegue = CAPACIDADES_DESPLIEGUE,
  badges: Partial<Record<IdSeccion, number>> = {},
): SeccionMiCuenta[] {
  return SECCIONES.filter((s) => s.visible(c, despliegue)).map((s) => ({
    id: s.id,
    label: s.label,
    ...(s.href ? { href: s.href } : {}),
    ...(s.tone ? { tone: s.tone } : {}),
    ...(s.grupo ? { grupo: s.grupo } : {}),
    ...(badges[s.id] ? { badge: badges[s.id] } : {}),
  }));
}

export interface GrupoSecciones<T> {
  id: IdGrupo;
  label: string;
  items: T[];
}

/**
 * Reparte las secciones (ya filtradas) en los grupos del menú, en su orden, y
 * deja aparte las sueltas (Cerrar sesión). Un grupo sin secciones no figura.
 * Genérica para que el shell pueda agrupar sus ítems ya armados.
 */
export function agruparSecciones<T extends Pick<SeccionMiCuenta, "grupo">>(
  secciones: readonly T[],
): { grupos: GrupoSecciones<T>[]; sueltas: T[] } {
  const grupos = GRUPOS_MI_CUENTA.map((g) => ({
    id: g.id,
    label: g.label,
    items: secciones.filter((s) => s.grupo === g.id),
  })).filter((g) => g.items.length > 0);
  return { grupos, sueltas: secciones.filter((s) => !s.grupo) };
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
    case "pagos":
    case "presupuestos":
    case "condiciones":
    case "avisos":
    case "favoritos":
    case "direcciones":
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
  facturas: "Facturas y saldo",
  pagos: "Pagos",
  presupuestos: "Presupuestos",
  condiciones: "Condiciones",
  avisos: "Avisos",
  favoritos: "Favoritos",
  direcciones: "Direcciones y envíos",
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
 * Bajada del saludo de Mi cuenta. Queda fija en todas las secciones, así que
 * resume todo lo que se puede hacer, no sólo los pedidos. Facturas y favoritos
 * se mencionan sólo cuando su sección está desplegada: no se promete algo que el
 * visitante no encuentra.
 */
export function bajadaMiCuenta(
  despliegue: CapacidadesDespliegue = CAPACIDADES_DESPLIEGUE,
): string {
  const acciones = [
    "Siga sus pedidos",
    despliegue.facturas && "consulte sus facturas y su saldo",
    despliegue.favoritos && "guarde sus favoritos",
  ].filter(Boolean);
  const datos = despliegue.direcciones ? "sus direcciones y datos" : "sus datos";
  return `${acciones.join(", ")} y administre ${datos}.`;
}

/**
 * `?volver=` de la página de vincular: solo rutas internas ("/checkout"), nunca
 * "//otro-sitio.example" ni una URL absoluta (sería un redirect abierto).
 */
export function volverSeguro(raw: string | string[] | undefined): string | undefined {
  const valor = Array.isArray(raw) ? raw[0] : raw;
  if (!valor || !valor.startsWith("/") || valor.startsWith("//") || valor.includes("\\")) {
    return undefined;
  }
  return valor;
}

/** Enlace a vincular la cuenta, opcionalmente volviendo a donde estaba. */
export function rutaVincular(volver?: string): string {
  const destino = volverSeguro(volver);
  return destino
    ? `${RUTAS_MI_CUENTA.vincular}?volver=${encodeURIComponent(destino)}`
    : RUTAS_MI_CUENTA.vincular;
}

/** Secciones de Facturación que tienen ruta propia y se prenden por despliegue. */
export type SeccionFacturacion = "facturas" | "pagos" | "presupuestos" | "condiciones" | "avisos";

/**
 * ¿La ruta de esta sección existe en este despliegue? Si no, la página responde
 * `notFound()`: una URL puesta a mano no puede adelantarse a la rebanada.
 */
export function seccionDesplegada(
  seccion: SeccionFacturacion,
  despliegue: CapacidadesDespliegue = CAPACIDADES_DESPLIEGUE,
): boolean {
  return despliegue[seccion];
}

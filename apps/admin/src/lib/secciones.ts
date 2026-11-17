// Catálogo de secciones del backoffice y política de acceso por sección (change
// `permisos-por-seccion`). Única fuente para el menú, los guards de páginas y de API, la UI de
// Usuarios y los tests. Sin React ni I/O: importable desde cualquier lado.
//
// Datos: `admin_users.secciones_permitidas` (text[] NULL) y `admin_users.ver_costos` (boolean
// NULL), migración 0106. NULL en ambas = default del rol = el comportamiento previo a 0106.
//
// Los flags (compras, usagePanel) y la restricción por canal del inbox (lib/canal-acceso.ts) NO
// entran acá: se componen encima, en el guard o en el layout.
import { isKnownAdminRole, roleRank } from "@/lib/roles"

export type Rol = "operator" | "admin" | "superadmin" | "compras"

export type SeccionClave =
  // Operación
  | "inbox"
  | "pedidos"
  | "comprobantes"
  | "compras"
  // Datos
  | "catalogo"
  | "clientes-tienda"
  | "sucursales"
  | "envios"
  | "cuotas"
  | "horarios"
  | "chat-tienda"
  | "tienda-online"
  | "etiquetas"
  // Fijas (no tildables): dependen sólo del rol
  | "plantillas"
  | "usuarios"
  | "seguridad"
  | "uso"

export type GrupoSeccion = "Operación" | "Datos" | "Administración"

export interface Seccion {
  clave: SeccionClave
  /** Texto del menú. */
  label: string
  href: string
  grupo: GrupoSeccion
  /** false: plantillas, usuarios, seguridad, uso. La lista del usuario nunca las concede ni las quita. */
  tildable: boolean
  /** Rol mínimo por defecto (== `minRole` del NAV previo; sin `minRole` = operator). */
  rolMin: "operator" | "admin" | "superadmin"
  flag?: "compras" | "usagePanel"
  badge?: "inbox" | "pedidos" | "comprobantes"
  /** Sólo `compras`: la única sección que ve el rol lateral «compras». */
  rolCompras?: true
}

/** En orden de visualización del menú (grupos contiguos). Copiado 1:1 del NAV de AdminShell. */
export const SECCIONES: readonly Seccion[] = [
  { clave: "inbox", label: "Mensajes", href: "/admin/inbox", grupo: "Operación", tildable: true, rolMin: "operator", badge: "inbox" },
  { clave: "pedidos", label: "Pedidos", href: "/admin/pedidos", grupo: "Operación", tildable: true, rolMin: "admin", badge: "pedidos" },
  { clave: "comprobantes", label: "Comprobantes", href: "/admin/comprobantes", grupo: "Operación", tildable: true, rolMin: "admin", badge: "comprobantes" },
  { clave: "compras", label: "Compras", href: "/admin/compras", grupo: "Operación", tildable: true, rolMin: "admin", flag: "compras", rolCompras: true },
  { clave: "catalogo", label: "Catálogo", href: "/admin/catalogo", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "clientes-tienda", label: "Clientes de la tienda", href: "/admin/clientes-tienda", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "sucursales", label: "Sucursales", href: "/admin/sucursales", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "envios", label: "Envíos", href: "/admin/envios", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "cuotas", label: "Pagos y cuotas", href: "/admin/cuotas", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "horarios", label: "Horarios", href: "/admin/horarios", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "chat-tienda", label: "Chat de la tienda", href: "/admin/chat-tienda", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "tienda-online", label: "Tienda online", href: "/admin/tienda-online", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "etiquetas", label: "Etiquetas", href: "/admin/etiquetas", grupo: "Datos", tildable: true, rolMin: "admin" },
  { clave: "plantillas", label: "Plantillas", href: "/admin/plantillas", grupo: "Datos", tildable: false, rolMin: "superadmin" },
  { clave: "usuarios", label: "Usuarios", href: "/admin/usuarios", grupo: "Administración", tildable: false, rolMin: "admin" },
  { clave: "seguridad", label: "Seguridad", href: "/admin/seguridad", grupo: "Administración", tildable: false, rolMin: "operator" },
  { clave: "uso", label: "Uso del bot", href: "/admin/uso", grupo: "Administración", tildable: false, rolMin: "superadmin", flag: "usagePanel" },
]

export const SECCION_POR_CLAVE: Readonly<Record<SeccionClave, Seccion>> = Object.fromEntries(
  SECCIONES.map((s) => [s.clave, s]),
) as Record<SeccionClave, Seccion>

export const SECCIONES_TILDABLES: readonly Seccion[] = SECCIONES.filter((s) => s.tildable)

/** Lo mínimo del usuario que necesita la política. Undefined en las columnas = NULL. */
export interface ActorSecciones {
  role: string
  seccionesPermitidas?: string[] | null
  verCostos?: boolean | null
}

export function esSeccionClave(clave: string): clave is SeccionClave {
  return Object.hasOwn(SECCION_POR_CLAVE, clave)
}

function esRolConocido(role: string): role is Rol {
  return role === "compras" || isKnownAdminRole(role)
}

function cumpleRolMin(role: string, rolMin: Seccion["rolMin"]): boolean {
  return roleRank(role) >= roleRank(rolMin)
}

/**
 * ¿Puede `u` ver la sección `clave`? Reglas, en orden:
 *  1. clave o rol desconocidos -> false (deny-by-default; la columna `role` es text sin CHECK).
 *  2. rol «compras»: sólo `compras` (ignora la lista).
 *  3. superadmin: todo (ignora la lista).
 *  4. sección no tildable: sólo por rol (`rolMin`); la lista nunca influye.
 *  5. tildable con lista NULL: default del rol (`rolMin`).
 *  6. tildable con lista: exactamente las de la lista (vacía = ninguna).
 */
export function puedeVerSeccion(u: ActorSecciones, clave: SeccionClave): boolean {
  if (!esSeccionClave(clave)) return false
  const role = u.role
  if (!esRolConocido(role)) return false
  if (role === "compras") return SECCION_POR_CLAVE[clave].rolCompras === true
  if (role === "superadmin") return true
  const seccion = SECCION_POR_CLAVE[clave]
  if (!seccion.tildable) return cumpleRolMin(role, seccion.rolMin)
  const lista = u.seccionesPermitidas
  if (lista == null) return cumpleRolMin(role, seccion.rolMin)
  return lista.includes(clave)
}

/** Secciones que `u` puede ver (incluye las fijas), en orden de catálogo. Sin flags. */
export function seccionesEfectivas(u: ActorSecciones): SeccionClave[] {
  return SECCIONES.filter((s) => puedeVerSeccion(u, s.clave)).map((s) => s.clave)
}

/** Secciones TILDABLES que el rol ve por defecto (lista NULL), en orden de catálogo. */
export function seccionesPorDefecto(role: string): SeccionClave[] {
  return SECCIONES_TILDABLES.filter((s) => puedeVerSeccion({ role, seccionesPermitidas: null }, s.clave)).map(
    (s) => s.clave,
  )
}

/** Default de «ver costos» por rol: admin y superadmin (la regla del retirado `canSeeCosts`; ver `puedeVerCostos`). */
export function costosPorDefecto(role: string): boolean {
  return isKnownAdminRole(role) && roleRank(role) >= roleRank("admin")
}

/** ¿Puede `u` ver precios de costo? Superadmin siempre; «compras»/desconocido nunca; si no, explícito ?? default. */
export function puedeVerCostos(u: ActorSecciones): boolean {
  if (u.role === "superadmin") return true
  if (u.role !== "operator" && u.role !== "admin") return false
  return u.verCostos ?? costosPorDefecto(u.role)
}

/**
 * Copia de `o` sin las claves de costo indicadas: para omitir en el SERVIDOR los campos de costo de
 * una respuesta cuando `puedeVerCostos` da falso (la clave no existe, no viaja en null).
 */
export function sinCampos<T extends object, K extends keyof T>(o: T, claves: readonly K[]): Omit<T, K> {
  const copia = { ...o }
  for (const k of claves) delete copia[k]
  return copia
}

/** Únicas, sólo claves tildables conocidas, en orden de catálogo. */
export function normalizarSecciones(lista: readonly string[]): SeccionClave[] {
  const pedidas = new Set(lista)
  return SECCIONES_TILDABLES.filter((s) => pedidas.has(s.clave)).map((s) => s.clave)
}

const ROLES_CON_LISTA = new Set(["operator", "admin"])

/**
 * `secciones_permitidas` resultante de cambiar el rol de `rolAnterior` a `rolNuevo`:
 *  - mismo rol: sin cambio.
 *  - hacia superadmin/compras (o rol desconocido): NULL (la lista se ignora; se limpia para no revivirla).
 *  - desde superadmin/compras (o desconocido) hacia operator/admin: NULL (default del rol nuevo).
 *  - entre operator y admin: se conserva recortada a claves tildables válidas (no gana secciones); NULL sigue NULL.
 * El techo del actor se revalida aparte, sobre el resultado.
 */
export function seccionesTrasCambioDeRol(
  rolAnterior: string,
  rolNuevo: string,
  lista: readonly string[] | null | undefined,
): string[] | null {
  if (rolAnterior === rolNuevo) return lista == null ? null : [...lista]
  if (!ROLES_CON_LISTA.has(rolNuevo) || !ROLES_CON_LISTA.has(rolAnterior)) return null
  return lista == null ? null : normalizarSecciones(lista)
}

/** `ver_costos` resultante del cambio de rol: se conserva sólo entre operator y admin. */
export function verCostosTrasCambioDeRol(
  rolAnterior: string,
  rolNuevo: string,
  verCostos: boolean | null | undefined,
): boolean | null {
  if (rolAnterior === rolNuevo) return verCostos ?? null
  if (!ROLES_CON_LISTA.has(rolNuevo) || !ROLES_CON_LISTA.has(rolAnterior)) return null
  return verCostos ?? null
}

/** Una clave o varias: un arreglo significa "cualquiera de" (rutas compartidas entre secciones). */
export type ClaveOAlguna = SeccionClave | readonly SeccionClave[]

/** Piso extra de rol sobre la sección (p. ej. subrutas del inbox que sólo edita admin+). */
export interface OpcionesSeccion {
  rolMin?: "admin" | "superadmin"
}

/**
 * Decisión común de `requireSeccion` (API) y `accesoSeccion` (páginas), sin I/O propio salvo el flag
 * de Compras, que se evalúa sólo si alguna de las secciones concedidas lo necesita. Orden: política
 * (`puedeVerSeccion`, any-of) -> `rolMin` -> flag. Cualquier "no" es el mismo `false` (404 arriba).
 */
export async function autorizaSeccion(
  u: ActorSecciones,
  clave: ClaveOAlguna,
  opts: OpcionesSeccion | undefined,
  flagCompras: () => Promise<boolean>,
): Promise<boolean> {
  const claves: readonly SeccionClave[] = typeof clave === "string" ? [clave] : clave
  const concedidas = claves.filter((c) => puedeVerSeccion(u, c))
  if (concedidas.length === 0) return false
  if (opts?.rolMin && !(isKnownAdminRole(u.role) && cumpleRolMin(u.role, opts.rolMin))) return false
  // Con varias claves alcanza una que pase también su flag.
  for (const c of concedidas) {
    if (SECCION_POR_CLAVE[c].flag !== "compras") return true
    if (await flagCompras()) return true
  }
  return false
}

/** Flags evaluados en el servidor que ocultan secciones enteras. */
export interface FlagsSecciones {
  compras: boolean
  usagePanel: boolean
}

/**
 * Secciones que el menú muestra a `u`: la política más los flags. La calcula el layout protegido
 * (servidor) y se la pasa a AdminShell, así el cliente no duplica la política.
 */
export function seccionesVisibles(u: ActorSecciones, flags: FlagsSecciones): SeccionClave[] {
  return SECCIONES.filter((s) => {
    if (s.flag === "compras" && !flags.compras) return false
    if (s.flag === "usagePanel" && !flags.usagePanel) return false
    return puedeVerSeccion(u, s.clave)
  }).map((s) => s.clave)
}

/**
 * Adónde entra el usuario al iniciar sesión (o en `/admin`): la primera sección de TRABAJO visible
 * en el orden del menú. Usuarios y Seguridad no cuentan como sección de trabajo; si no hay
 * ninguna, cae en Seguridad (que todo usuario conocido tiene).
 */
export function primeraSeccionVisible(visibles: readonly SeccionClave[]): string {
  const deTrabajo = SECCIONES.find(
    (s) => s.clave !== "usuarios" && s.clave !== "seguridad" && visibles.includes(s.clave),
  )
  return deTrabajo?.href ?? SECCION_POR_CLAVE.seguridad.href
}

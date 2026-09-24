/**
 * Reglas PURAS del carrito por usuario: las usan el navegador (CartContext) y
 * el servidor (/api/carrito, src/lib/carrito-db.ts).
 *
 * Sin imports de base, de Next ni de `alegra.ts` (que lee variables de entorno
 * del servidor): este módulo termina en el bundle del cliente. Toda decisión
 * del carrito vive acá para poder testearla en node, sin DOM.
 */

/** Lo único que se guarda en la base: id de Alegra y cantidad. */
export type LineaCarrito = { id: string; qty: number };

export interface CartItem {
  id: string;
  name: string;
  brand: string;
  variant?: string;
  /** Referencial, para mostrar mientras llega la cotización real. */
  price: number;
  qty: number;
  /**
   * true si el producto ya no está en el espejo del catálogo. El ítem no se
   * descarta (el carrito del usuario no se edita solo): la cotización lo marca
   * con problema.
   */
  faltante?: boolean;
}

/** Caché local: `owner` es el userId de Clerk, o null para invitado / cookie CRM. */
export type CacheCarrito = {
  owner: string | null;
  /** Versión del servidor que vio esta caché; null si nunca se sincronizó. */
  version: number | null;
  items: CartItem[];
};

export type AvisoCarrito = "lineas" | "cantidad";

export type AccionAlCargar = "esperar" | "descartar" | "merge" | "refrescar" | "nada";

/** Tope duro de unidades por línea. */
export const QTY_MAX = 9_999;
/** Techo de líneas (productos distintos) por carrito y por pedido. */
export const MAX_LINEAS = 60;
/** Tope de entradas en el body de la API: más que esto es basura, no un carrito. */
export const MAX_ENTRADAS_BODY = 200;
/** Largo máximo de un id de Alegra aceptado del browser. */
const ID_MAX_LARGO = 64;

export const CLAVE_CACHE = "centralled.carrito.v2";
export const CLAVE_CACHE_V1 = "centralled.carrito.v1";

/** Constante estable: devolver `[]` nuevo en cada snapshot es un loop infinito. */
export const CARRITO_VACIO: CartItem[] = [];

/** Textos visibles del carrito (usted). */
export const COPY_CARRITO = {
  noAutorizado: "Inicie sesión para guardar su carrito.",
  invalido: "El carrito enviado no es válido.",
  demasiadas: "Demasiadas solicitudes. Inténtelo de nuevo en unos segundos.",
  lineas: "Algunos productos no se agregaron porque su carrito alcanzó el máximo de 60 productos.",
  cantidad: "Se ajustó la cantidad al máximo permitido.",
  errorGuardar: "No pudimos guardar su carrito. Inténtelo de nuevo.",
  otroDispositivo: "Su carrito se actualizó desde otro dispositivo.",
  pagoPendiente: "Puede completar el pago desde Mis pedidos.",
} as const;

/**
 * Mismo criterio que `esIdAlegra` (src/lib/alegra.ts): enteros positivos. Se
 * repite acá porque aquel módulo es sólo de servidor.
 */
function esIdValido(id: unknown): id is string {
  return typeof id === "string" && id.length <= ID_MAX_LARGO && /^\d+$/.test(id);
}

function sumarAviso(avisos: AvisoCarrito[], aviso: AvisoCarrito) {
  if (!avisos.includes(aviso)) avisos.push(aviso);
}

// --- Normalización y merge --------------------------------------------------

/**
 * Deja un carrito en forma: ids únicos (los duplicados SUMAN), qty entera en
 * 1..QTY_MAX, a lo sumo MAX_LINEAS líneas. Descarta qty <= 0 e ids vacíos sin
 * aviso; el tope de cantidad y el recorte de líneas sí avisan (no son
 * silenciosos). Conserva el orden y los demás campos de la primera aparición.
 */
export function normalizarCarrito<T extends LineaCarrito>(
  entrada: readonly T[],
): { items: T[]; avisos: AvisoCarrito[] } {
  const avisos: AvisoCarrito[] = [];
  const porId = new Map<string, T>();
  for (const linea of entrada) {
    const qty = Math.floor(Number(linea.qty));
    if (!linea.id || !Number.isFinite(qty) || qty <= 0) continue;
    const previa = porId.get(linea.id);
    porId.set(linea.id, previa ? { ...previa, qty: previa.qty + qty } : { ...linea, qty });
  }
  const items = [...porId.values()].map((i) => {
    if (i.qty <= QTY_MAX) return i;
    sumarAviso(avisos, "cantidad");
    return { ...i, qty: QTY_MAX };
  });
  if (items.length > MAX_LINEAS) {
    sumarAviso(avisos, "lineas");
    items.length = MAX_LINEAS;
  }
  return { items, avisos };
}

/**
 * Une el carrito del servidor con el de un invitado que acaba de ingresar:
 * por producto, la cantidad MAYOR (no la suma). Así es idempotente: varias
 * pestañas que mergean el mismo invitado convergen al mismo carrito.
 *
 * Orden: primero las líneas del servidor, después las nuevas del invitado. Si
 * pasa de MAX_LINEAS se descartan las últimas del invitado (el servidor tiene
 * prioridad) y se avisa.
 */
export function mergeMax(
  servidor: readonly LineaCarrito[],
  invitado: readonly LineaCarrito[],
): { items: LineaCarrito[]; avisos: AvisoCarrito[] } {
  const inv = normalizarCarrito(invitado.map((i) => ({ id: i.id, qty: i.qty })));
  const avisos = [...inv.avisos];
  const deInvitado = new Map(inv.items.map((i) => [i.id, i.qty]));

  const union: LineaCarrito[] = servidor.map((s) => ({
    id: s.id,
    qty: Math.max(s.qty, deInvitado.get(s.id) ?? 0),
  }));
  const enServidor = new Set(servidor.map((s) => s.id));
  for (const i of inv.items) if (!enServidor.has(i.id)) union.push(i);

  const final = normalizarCarrito(union);
  for (const a of final.avisos) sumarAviso(avisos, a);
  return { items: final.items, avisos };
}

// --- Validación del body de la API ------------------------------------------

/**
 * Valida la FORMA del body `{ items: [{id, qty}] }`: sólo tipos, no reglas de
 * negocio (duplicados, qty <= 0 o de más se arreglan en `normalizarCarrito`).
 * null → 400. Devuelve sólo id y qty: cualquier otro campo del body (un
 * `userId`, por ejemplo) se ignora.
 */
export function validarItemsBody(raw: unknown): LineaCarrito[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length > MAX_ENTRADAS_BODY) return null;
  const lineas: LineaCarrito[] = [];
  for (const i of items) {
    if (!i || typeof i !== "object") return null;
    const { id, qty } = i as { id?: unknown; qty?: unknown };
    if (!esIdValido(id) || typeof qty !== "number" || !Number.isSafeInteger(qty)) return null;
    lineas.push({ id, qty });
  }
  return lineas;
}

/** Versión que el cliente vio: entero >= 0. null → 400. */
export function validarVersion(raw: unknown): number | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

// --- Mutaciones locales -----------------------------------------------------

/** Suma `qty` de un producto. No agrega una línea nueva si ya hay MAX_LINEAS. */
export function agregar(
  items: CartItem[],
  nuevo: Omit<CartItem, "qty">,
  qty = 1,
): { items: CartItem[]; avisos: AvisoCarrito[] } {
  const cant = Math.floor(qty);
  if (!(cant > 0)) return { items, avisos: [] };
  const avisos: AvisoCarrito[] = [];
  const existente = items.find((i) => i.id === nuevo.id);
  if (existente) {
    const suma = existente.qty + cant;
    if (suma > QTY_MAX) avisos.push("cantidad");
    return {
      items: items.map((i) =>
        i.id === nuevo.id ? { ...i, ...nuevo, qty: Math.min(suma, QTY_MAX) } : i,
      ),
      avisos,
    };
  }
  if (items.length >= MAX_LINEAS) return { items, avisos: ["lineas"] };
  if (cant > QTY_MAX) avisos.push("cantidad");
  return { items: [...items, { ...nuevo, qty: Math.min(cant, QTY_MAX) }], avisos };
}

/** Varias altas como UNA sola actualización (p. ej. "Repetir pedido"). */
export function agregarVarios(
  items: CartItem[],
  lista: readonly { item: Omit<CartItem, "qty">; qty: number }[],
): { items: CartItem[]; avisos: AvisoCarrito[] } {
  const avisos: AvisoCarrito[] = [];
  let actual = items;
  for (const { item, qty } of lista) {
    const r = agregar(actual, item, qty);
    actual = r.items;
    for (const a of r.avisos) sumarAviso(avisos, a);
  }
  return { items: actual, avisos };
}

/** Fija la cantidad de una línea; con qty <= 0 la quita. */
export function actualizarQty(
  items: CartItem[],
  id: string,
  qty: number,
): { items: CartItem[]; avisos: AvisoCarrito[] } {
  const cant = Math.floor(qty);
  if (!(cant > 0)) return { items: items.filter((i) => i.id !== id), avisos: [] };
  const avisos: AvisoCarrito[] = cant > QTY_MAX ? ["cantidad"] : [];
  return {
    items: items.map((i) => (i.id === id ? { ...i, qty: Math.min(cant, QTY_MAX) } : i)),
    avisos,
  };
}

/** Lo que viaja al servidor: sólo id y qty. */
export function aLineas(items: readonly LineaCarrito[]): LineaCarrito[] {
  return items.map(({ id, qty }) => ({ id, qty }));
}

// --- Caché local ------------------------------------------------------------

/**
 * Valida item por item: el storage es editable por el usuario y sobrevive a
 * deploys, así que puede tener la forma de una versión anterior del carrito.
 */
function parsearItems(parsed: unknown): CartItem[] | null {
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((i): CartItem[] => {
    const item = i as Partial<CartItem> | null;
    const qty = Math.floor(Number(item?.qty));
    if (!item?.id || !Number.isFinite(qty) || qty <= 0) return [];
    return [
      {
        id: String(item.id),
        name: String(item.name ?? ""),
        brand: String(item.brand ?? ""),
        variant: item.variant ? String(item.variant) : undefined,
        price: Number(item.price) || 0,
        qty: Math.min(qty, QTY_MAX),
        ...(item.faltante === true ? { faltante: true } : {}),
      },
    ];
  });
}

/**
 * Lee la caché v2 (`{owner, version, items}`). Si no hay v2 y hay una v1
 * (array de ítems, sin dueño), la adopta como carrito de invitado. Basura →
 * carrito de invitado vacío.
 */
export function parsearCache(rawV2: string | null, rawV1: string | null): CacheCarrito {
  const vacio: CacheCarrito = { owner: null, version: null, items: CARRITO_VACIO };
  try {
    if (rawV2 !== null) {
      const p = JSON.parse(rawV2) as Partial<CacheCarrito> | null;
      if (!p || typeof p !== "object") return vacio;
      const owner = p.owner === null || p.owner === undefined ? null : p.owner;
      if (owner !== null && (typeof owner !== "string" || !owner)) return vacio;
      const items = parsearItems(p.items);
      if (!items) return vacio;
      return { owner, version: validarVersion(p.version), items };
    }
    if (rawV1 !== null) {
      const items = parsearItems(JSON.parse(rawV1));
      return items ? { owner: null, version: null, items } : vacio;
    }
  } catch {
    return vacio;
  }
  return vacio;
}

/**
 * Nunca mostrar el carrito de otro: una caché con dueño sólo se ve con la
 * sesión de ese mismo usuario ya cargada.
 */
export function itemsVisibles(
  cache: CacheCarrito,
  auth: { isLoaded: boolean; usuario: string | null },
): CartItem[] {
  if (cache.owner === null) return cache.items;
  return auth.isLoaded && auth.usuario === cache.owner ? cache.items : CARRITO_VACIO;
}

/** Qué hacer con la caché cuando se conoce (o cambia) la sesión de Clerk. */
export function accionAlCargar(
  cache: CacheCarrito,
  usuario: string | null,
  isLoaded: boolean,
): AccionAlCargar {
  if (!isLoaded) return "esperar";
  if (cache.owner !== null && cache.owner !== usuario) return "descartar";
  if (usuario === null) return "nada";
  if (cache.owner === null && cache.items.length > 0) return "merge";
  return "refrescar";
}

/** ¿Cambió lo que importa (id y qty)? Para avisar sólo si el 409 cambió algo. */
export function contenidoDistinto(
  a: readonly LineaCarrito[],
  b: readonly LineaCarrito[],
): boolean {
  const ma = new Map(a.map((i) => [i.id, i.qty]));
  const mb = new Map(b.map((i) => [i.id, i.qty]));
  if (ma.size !== mb.size) return true;
  for (const [id, qty] of ma) if (mb.get(id) !== qty) return true;
  return false;
}

// --- Mensajes ---------------------------------------------------------------

export function mensajeError(status: number): string {
  switch (status) {
    case 401:
      return COPY_CARRITO.noAutorizado;
    case 400:
      return COPY_CARRITO.invalido;
    case 409:
      return COPY_CARRITO.otroDispositivo;
    case 429:
      return COPY_CARRITO.demasiadas;
    default:
      return COPY_CARRITO.errorGuardar;
  }
}

export function mensajeAviso(aviso: AvisoCarrito): string {
  return aviso === "lineas" ? COPY_CARRITO.lineas : COPY_CARRITO.cantidad;
}

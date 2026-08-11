/**
 * Cliente HTTP para la API de Alegra (sistema de gestion / facturacion).
 *
 * IMPORTANTE: este modulo es SOLO de servidor. Nunca importarlo desde componentes
 * cliente ni exponer el token: las credenciales viven en variables sin prefijo
 * NEXT_PUBLIC y solo se usan dentro de API routes / Server Components.
 *
 * Auth: HTTP Basic con base64("email:token"). El token se genera en
 * Alegra > Configuracion > API.
 * Docs: https://developer.alegra.com/reference
 */

const BASE_URL = process.env.ALEGRA_BASE_URL ?? "https://api.alegra.com/api/v1";

/** Header Authorization calculado una sola vez a partir del email + token. */
function authHeader(): string {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  if (!email || !token) {
    throw new Error(
      "Faltan ALEGRA_EMAIL o ALEGRA_TOKEN en el entorno. Revisar .env.local."
    );
  }
  const encoded = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${encoded}`;
}

type QueryParams = Record<string, string | number | undefined>;

/** Alegra topea `limit` en 30 por página. No es configurable. */
const PAGE_SIZE = 30;

/**
 * Páginas que se piden en paralelo por tanda. Con ~2800 items, pedir de a una
 * (await secuencial) son ~94 round-trips y la función serverless se come el
 * timeout. Mismo valor y misma razón que en el CRM.
 */
const PAGE_CONCURRENCY = 8;

/**
 * Fetch generico contra la API de Alegra. Arma el querystring, aplica auth
 * y normaliza el manejo de errores.
 */
async function apiFetch<T>(path: string, params: QueryParams = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    // Datos de gestion: no cachear a nivel fetch, lo maneja cada caller.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alegra ${res.status} en ${path}: ${body.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Recorre un endpoint paginado de Alegra (start/limit) hasta agotarlo.
 * Corta cuando una página vuelve vacía o incompleta (< PAGE_SIZE).
 */
async function fetchAllPages<T>(
  path: string,
  map: (raw: Record<string, unknown>) => T,
  extraParams: QueryParams = {}
): Promise<T[]> {
  const out: T[] = [];
  let start = 0;
  let done = false;

  while (!done) {
    const starts = Array.from(
      { length: PAGE_CONCURRENCY },
      (_, i) => start + i * PAGE_SIZE
    );
    const pages = await Promise.all(
      starts.map((s) =>
        apiFetch<Record<string, unknown>[]>(path, {
          ...extraParams,
          start: s,
          limit: PAGE_SIZE,
        })
      )
    );

    for (const page of pages) {
      if (!Array.isArray(page) || page.length === 0) {
        done = true;
        break;
      }
      for (const row of page) out.push(map(row));
      if (page.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }
    start += PAGE_CONCURRENCY * PAGE_SIZE;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Tipos (parciales — Alegra devuelve mas campos; tipamos los que usa el shop).
// TODO: verificar nombres exactos contra una cuenta real antes de produccion.
// ---------------------------------------------------------------------------

/** Un precio de un item, potencialmente asociado a una lista de precios. */
export interface AlegraPrice {
  /** ID de la lista de precios (UUID string en Alegra). */
  idPriceList?: string;
  name?: string;
  price: number;
  /** true en el precio de la lista principal (default). */
  main?: boolean;
}

/** Impuesto asociado a un item. `percentage` puede venir string o number. */
export interface AlegraTax {
  id?: string | number;
  name?: string;
  percentage?: string | number;
}

export interface AlegraItem {
  id: string;
  name: string;
  reference?: string;
  description?: string;
  status: "active" | "inactive";
  /** Alegra suele devolver price como array (uno por lista de precios). */
  price: AlegraPrice[] | number;
  /** Impuestos del item. En AR: IVA 21 / 10.5 / 0 (exento). */
  tax?: AlegraTax[];
  inventory?: {
    availableQuantity?: number;
    unitCost?: number;
  };
  [key: string]: unknown;
}

export interface AlegraContact {
  id: string;
  name: string;
  identification?: string; // CUIT / DNI
  email?: string;
  phonePrimary?: string;
  /**
   * Lista de precios asignada al cliente, si tiene una. `status` importa: en la
   * cuenta real hay contactos apuntando a listas dadas de baja (una se llama
   * literalmente "NO USAR"). Ver `idPriceListUsable`.
   */
  priceList?: { id: string; name: string; status?: string } | null;
  [key: string]: unknown;
}

export interface AlegraPriceList {
  id: string;
  name: string;
  status?: string;
  main?: boolean;
  [key: string]: unknown;
}

export interface AlegraInvoice {
  id: string;
  date: string;
  dueDate?: string;
  total: number;
  balance?: number;
  status: string;
  client: { id: string; name: string };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Contactos (clientes)
// ---------------------------------------------------------------------------

/** Lista de contactos con filtros/paginacion (start, limit, order_field...). */
export function getContactos(params?: QueryParams) {
  return apiFetch<AlegraContact[]>("/contacts", params);
}

export function getContacto(id: string) {
  return apiFetch<AlegraContact>(`/contacts/${id}`);
}

/**
 * Busca un cliente por su CUIT/identificacion. Alegra filtra contactos por el
 * parametro `identification`; devolvemos el primero o null.
 */
export async function buscarContactoPorIdentificacion(
  identification: string
): Promise<AlegraContact | null> {
  const results = await getContactos({ identification, limit: 1 });
  return results?.[0] ?? null;
}

/**
 * Busca un contacto por email. Alegra filtra con el parametro `email`
 * (verificado contra la cuenta real; `query` NO filtra, devuelve vacio).
 *
 * Devuelve TODOS los que matchean, no el primero: si dos contactos comparten
 * casilla, quien llama tiene que decidir que hacer en vez de elegir uno al azar
 * y vincular a la empresa equivocada.
 */
export async function buscarContactosPorEmail(
  email: string
): Promise<AlegraContact[]> {
  const results = await getContactos({ email, limit: 5 });
  return Array.isArray(results) ? results : [];
}

/** ¿Es un cliente? En esta cuenta la mayoria de los contactos son proveedores. */
export function esCliente(contacto: AlegraContact): boolean {
  const tipos = contacto.type;
  return Array.isArray(tipos) && (tipos as string[]).includes("client");
}

/**
 * Id de la lista de precios del contacto, SOLO si es usable.
 *
 * Una lista dada de baja en Alegra no deja de estar asignada al contacto: la
 * referencia queda apuntando a una lista muerta. En la cuenta real hay un
 * cliente cuya lista se llama literalmente "NO USAR" y esta `inactive`.
 * Cotizarle contra eso es cobrarle cualquier cosa.
 *
 * `undefined` = usar la lista principal, que es el default correcto.
 */
export function idPriceListUsable(
  contacto: Pick<AlegraContact, "priceList"> | null | undefined
): string | undefined {
  const lista = contacto?.priceList;
  if (!lista?.id) return undefined;
  // Solo se descarta si Alegra dice explicitamente que no esta activa: si no
  // manda `status`, se asume usable para no romper cuentas bien cargadas.
  if (lista.status && lista.status !== "active") {
    console.warn(
      `[alegra] lista de precios "${lista.name}" (${lista.id}) esta ${lista.status}: se ignora y se usa la principal`
    );
    return undefined;
  }
  return String(lista.id);
}

// ---------------------------------------------------------------------------
// Items (productos)
// ---------------------------------------------------------------------------

/** Catalogo. Params utiles: start, limit, order_field, name, status. */
export function getItems(params?: QueryParams) {
  return apiFetch<AlegraItem[]>("/items", params);
}

export function getItem(id: string) {
  return apiFetch<AlegraItem>(`/items/${id}`);
}

// ---------------------------------------------------------------------------
// Listas de precios
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Categorias de items
// ---------------------------------------------------------------------------

export interface AlegraItemCategory {
  id: string;
  name: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Categorias del catalogo. Endpoint propio: evita tener que escanear los ~2800
 * items para saber que categorias existen (Alegra topea en 30 items/request).
 */
export function getItemCategories(params?: QueryParams) {
  return apiFetch<AlegraItemCategory[]>("/item-categories", params);
}

export function getListasPrecios(params?: QueryParams) {
  return apiFetch<AlegraPriceList[]>("/price-lists", params);
}

// ---------------------------------------------------------------------------
// Facturas
// ---------------------------------------------------------------------------

export function getFacturas(params?: QueryParams) {
  return apiFetch<AlegraInvoice[]>("/invoices", params);
}

export function getFactura(id: string) {
  return apiFetch<AlegraInvoice>(`/invoices/${id}`);
}

// ---------------------------------------------------------------------------
// Catalogo completo — solo para la sync (src/lib/catalog-sync.ts)
//
// Estas funciones recorren TODO el catalogo (~2800 items) paginando. Son caras:
// no llamarlas desde el request de un usuario, solo desde el cron de sync.
// ---------------------------------------------------------------------------

/** Fila normalizada de item, lista para escribir en catalog_products. */
export interface ItemSyncRow {
  alegraId: string;
  code: string | null;
  name: string;
  description: string | null;
  categoryAlegraId: string | null;
  brand: string | null;
  prices: AlegraPrice[];
  stock: number | null;
  status: string;
}

/** Fila normalizada de categoria, lista para escribir en catalog_categories. */
export interface CategorySyncRow {
  alegraId: string;
  name: string;
  parentAlegraId: string | null;
  status: string;
}

/**
 * Extrae la marca de los customFields de un item. Alegra no tiene campo "marca"
 * nativo, asi que se busca un custom field cuyo nombre matchee marca/brand.
 * Devuelve null si no hay: quien lee decide el fallback.
 */
export function marcaDeCustomFields(customFields: unknown): string | null {
  if (!Array.isArray(customFields)) return null;
  const campo = (customFields as Array<{ name?: unknown; value?: unknown }>).find(
    (c) => /marca|brand/i.test(String(c?.name ?? ""))
  );
  const valor = campo?.value;
  return valor ? String(valor) : null;
}

function mapItemRow(raw: Record<string, unknown>): ItemSyncRow {
  const priceRaw = Array.isArray(raw.price)
    ? (raw.price as Record<string, unknown>[])
    : [];
  const prices: AlegraPrice[] = priceRaw.map((p) => ({
    idPriceList: p.idPriceList != null ? String(p.idPriceList) : undefined,
    name: p.name != null ? String(p.name) : undefined,
    price: Number(p.price ?? 0),
    main: Boolean(p.main),
  }));

  const cat = raw.itemCategory as { id?: unknown } | undefined;
  const inv = raw.inventory as { availableQuantity?: unknown } | undefined;
  // `reference` viene como string o como { reference } segun el item.
  const ref = raw.reference as { reference?: unknown } | string | undefined;
  const code =
    typeof ref === "string"
      ? ref
      : ref?.reference != null
        ? String(ref.reference)
        : null;

  return {
    alegraId: String(raw.id),
    code: code || null,
    name: String(raw.name ?? ""),
    description: raw.description ? String(raw.description) : null,
    categoryAlegraId: cat?.id != null ? String(cat.id) : null,
    brand: marcaDeCustomFields(raw.customFields),
    prices,
    stock: inv?.availableQuantity != null ? Number(inv.availableQuantity) : null,
    status: String(raw.status ?? "active"),
  };
}

function mapCategoryRow(raw: Record<string, unknown>): CategorySyncRow {
  const parent = raw.parent as { id?: unknown } | undefined;
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    parentAlegraId: parent?.id != null ? String(parent.id) : null,
    status: String(raw.status ?? "active"),
  };
}

/** Todos los items del catalogo. Orden estable por id para paginar sin saltos. */
export function listAllItems(): Promise<ItemSyncRow[]> {
  return fetchAllPages("/items", mapItemRow, {
    order_field: "id",
    order_direction: "ASC",
  });
}

/** Todas las categorias de items. */
export function listAllCategories(): Promise<CategorySyncRow[]> {
  return fetchAllPages("/item-categories", mapCategoryRow);
}

// ---------------------------------------------------------------------------
// Helpers de mapeo hacia las formas que ya usa el shop
// ---------------------------------------------------------------------------

/**
 * Resuelve el precio de un item para una lista de precios dada.
 * Prioridad: lista del cliente (`idPriceList`) → lista principal (`main`) →
 * primer precio disponible.
 */
export function resolverPrecio(
  item: AlegraItem,
  idPriceList?: string
): number {
  if (typeof item.price === "number") return item.price;
  return precioDeLista(item.price, idPriceList);
}

/**
 * Alícuota de IVA de un item, en porcentaje (21, 10.5, 0…).
 *
 * Se suman todos los impuestos del item porque un mismo item puede tener IVA +
 * un impuesto interno. Si Alegra no devuelve `tax` (item viejo o mal cargado)
 * se cae a `IVA_DEFAULT`: es preferible cobrar de más y que un operador
 * corrija, a facturar sin IVA algo que sí lo lleva.
 */
export const IVA_DEFAULT = 21;

export function ivaDeItem(item: Pick<AlegraItem, "tax">): number {
  if (!Array.isArray(item.tax) || item.tax.length === 0) return IVA_DEFAULT;
  const total = item.tax.reduce((acc, t) => {
    const pct = Number(t?.percentage);
    return acc + (Number.isFinite(pct) ? pct : 0);
  }, 0);
  // Un array de impuestos presente pero con 0% es un item exento legítimo.
  return total;
}

/**
 * Misma resolución de precio, pero sobre un array de precios suelto — es la
 * forma en que el espejo local guarda `catalog_products.prices`.
 */
export function precioDeLista(
  prices: AlegraPrice[] | undefined,
  idPriceList?: string
): number {
  if (!Array.isArray(prices) || prices.length === 0) return 0;
  if (idPriceList) {
    const match = prices.find((p) => p.idPriceList === idPriceList);
    if (match) return match.price;
  }
  const principal = prices.find((p) => p.main);
  return (principal ?? prices[0]).price;
}

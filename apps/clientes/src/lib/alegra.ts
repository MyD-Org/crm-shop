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

export interface AlegraItem {
  id: string;
  name: string;
  reference?: string;
  description?: string;
  status: "active" | "inactive";
  /** Alegra suele devolver price como array (uno por lista de precios). */
  price: AlegraPrice[] | number;
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
  /** Lista de precios asignada al cliente, si tiene una. */
  priceList?: { id: string; name: string } | null;
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
  if (!Array.isArray(item.price) || item.price.length === 0) return 0;
  if (idPriceList) {
    const match = item.price.find((p) => p.idPriceList === idPriceList);
    if (match) return match.price;
  }
  const principal = item.price.find((p) => p.main);
  return (principal ?? item.price[0]).price;
}

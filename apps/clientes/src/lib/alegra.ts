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

// `|| ` y no `?? `: en GitHub Actions un secret que no existe llega como STRING
// VACÍO, no como undefined, y con `??` el default no entraba — la sync fallaba con
// "Invalid URL" (corrida 35282628485, 17/09/2026).
const BASE_URL =
  process.env.ALEGRA_BASE_URL?.trim() || "https://api.alegra.com/api/v1";

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

export type QueryParams = Record<string, string | number | undefined>;

/** Alegra topea `limit` en 30 por página. No es configurable. */
const PAGE_SIZE = 30;

/**
 * Páginas que se piden en paralelo por tanda. Con ~5959 items, pedir de a una
 * (await secuencial) son ~199 round-trips y no termina nunca. Con 8 Alegra
 * empezó a responder 429 (13/09/2026) y la sync diaria fallaba entera: 4 es el
 * equilibrio. La corrida entera tarda ~3 min, que es justamente por lo que la
 * sync se mudó a GitHub Actions (no hay techo de 300 s ahí).
 */
const PAGE_CONCURRENCY = 4;

/** Reintentos ante 429 antes de rendirse. Backoff 1-2-4-8-16 s ≈ 31 s peor caso. */
const MAX_RETRIES_429 = 5;
const BACKOFF_BASE_MS = 1_000;
/** Tope a un Retry-After exagerado: no puede comerse el presupuesto de la corrida. */
const MAX_RETRY_AFTER_MS = 30_000;

function esperaTras429(res: Response, intento: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, MAX_RETRY_AFTER_MS);
  }
  return BACKOFF_BASE_MS * 2 ** intento;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch generico contra la API de Alegra. Arma el querystring, aplica auth
 * y normaliza el manejo de errores. Ante 429 (rate limit) espera y reintenta.
 */
/**
 * ¿Es un id de Alegra válido? Los ids reales son enteros positivos. Todo id que
 * venga del browser pasa por acá ANTES de armar una ruta: sin esto,
 * `"../contacts/123"` se resuelve (via `new URL`) a `/contacts/123` y cualquier
 * logueado lee contactos a traves de `/items/:id`.
 */
export function esIdAlegra(id: unknown): id is string {
  return typeof id === "string" && /^\d+$/.test(id);
}

/** Segmento de ruta seguro para un id: valida y escapa. Tira si no es un id. */
function segmentoId(id: string): string {
  if (!esIdAlegra(id)) throw new Error(`Id de Alegra invalido: ${JSON.stringify(id).slice(0, 40)}`);
  return encodeURIComponent(id);
}

/**
 * Exportado para `lib/cuenta-corriente/alegra-cc.ts` (facturas, pagos,
 * presupuestos y PDF del cliente): mismos reintentos ante 429 y mismo manejo de
 * errores que el resto del Shop. Un error de Alegra se lanza como
 * `Error("Alegra <status> en <path>: …")`.
 */
export async function apiFetch<T>(
  path: string,
  params: QueryParams = {},
  init: { method?: "GET" | "PUT"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let res: Response;
  for (let intento = 0; ; intento++) {
    res = await fetch(url, {
      method: init.method ?? "GET",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      headers: {
        Authorization: authHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      // Datos de gestion: no cachear a nivel fetch, lo maneja cada caller.
      cache: "no-store",
      signal: init.signal,
    });
    if (res.status !== 429 || intento >= MAX_RETRIES_429) break;
    await res.body?.cancel();
    await sleep(esperaTras429(res, intento));
  }

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
  phoneSecondary?: string;
  mobile?: string;
  /**
   * Lista de precios asignada al cliente, si tiene una. `status` importa: en la
   * cuenta real hay contactos apuntando a listas dadas de baja (una se llama
   * literalmente "NO USAR"). Ver `idPriceListUsable`.
   */
  priceList?: { id: string; name: string; status?: string } | null;
  /** Plazo de pago asignado ("Contado" = 0 días, "30 días"…). */
  term?: { id?: string; name?: string; days?: number | string | null } | null;
  /** Límite de crédito cargado en Alegra. */
  creditLimit?: number | string | null;
  /** "FINAL_CONSUMER" | "IVA_RESPONSABLE" | "UNIQUE_TRIBUTE_RESPONSABLE" | "IVA_EXEMPT" | "". */
  ivaCondition?: string | null;
  /** Tipo ("CUIT" | "DNI" | "") y número del documento. */
  identificationObject?: { type?: string | null; number?: string | null } | null;
  /** Domicilio. En la cuenta real no trae `country`. */
  address?: { address?: string; city?: string; province?: string; postalCode?: string } | null;
  [key: string]: unknown;
}

/**
 * Cuenta corriente o contado, deducido del contacto: Alegra no tiene un campo propio.
 * En la sucursal, a un cliente de cuenta corriente le cargan un plazo de pago y/o un
 * límite de crédito; sin ninguno de los dos, es contado.
 *
 * La regla CANÓNICA es la columna generada `tipo_cuenta` del espejo de contactos
 * (apps/admin/drizzle/0030_alegra_contacts.sql), y es la que el Shop lee de la
 * vista. Esta función es SÓLO para contactos leídos en vivo de Alegra (respaldo
 * cuando el espejo no tiene la fila); su test copia la tabla de casos del CRM.
 */
export function tipoCuentaDe(
  contacto: Pick<AlegraContact, "term" | "creditLimit"> | null | undefined,
): "corriente" | "contado" {
  const dias = Number(contacto?.term?.days ?? 0);
  const limite = Number(contacto?.creditLimit ?? 0);
  return dias > 0 || limite > 0 ? "corriente" : "contado";
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

export async function getContacto(id: string) {
  return apiFetch<AlegraContact>(`/contacts/${segmentoId(id)}`);
}

/**
 * Reemplaza las observaciones de un contacto (PUT /contacts/{id}).
 *
 * Alegra no acepta un PUT con solo `observations`: exige también `name`,
 * `ivaCondition` e `identificationObject` ("El nombre del contacto es
 * obligatorio", "La condición de IVA es un campo obligatorio"). Se reenvían
 * TAL CUAL vienen del GET recién hecho, así que no cambian; lo que no viene en
 * el body Alegra no lo toca (verificado 2026-09-24 contra la cuenta real: el
 * único campo que cambió fue `observations`).
 *
 * Es la ÚNICA escritura del Shop sobre un contacto de Alegra. Ver
 * `registrarEmailAlternativo` en vinculacion.ts para el porqué.
 *
 * Ojo: `/contacts` tiene un tope propio y al pasarse responde 400 con
 * `{"code":429}` en el body (no un 429), así que ese caso NO se reintenta y
 * llega como error. Quien llama tiene que fallar en silencio.
 */
export async function actualizarObservacionesContacto(contacto: AlegraContact, observations: string) {
  return actualizarContactoTalCual(contacto, { observations });
}

/**
 * PUT que reenvía `name`, `ivaCondition` e `identificationObject` TAL CUAL
 * vinieron del GET (obligatorios para Alegra, no cambian) más `extra`
 * (observaciones, un teléfono que estaba vacío). Mismos cuidados que arriba.
 */
export async function actualizarContactoTalCual(contacto: AlegraContact, extra: Record<string, unknown>) {
  const body: Record<string, unknown> = { name: contacto.name, ...extra };
  if (contacto.ivaCondition != null) body.ivaCondition = contacto.ivaCondition;
  if (contacto.identificationObject != null) body.identificationObject = contacto.identificationObject;
  return actualizarContacto(contacto.id, body);
}

/** Cuánto se espera un PUT a /contacts antes de darlo por fallido (R8). */
export const TIMEOUT_PUT_CONTACTO_MS = 8_000;

/**
 * PUT /contacts/{id} genérico, con timeout. Devuelve el contacto COMPLETO que
 * responde Alegra (es lo que se pasa al write-through del espejo).
 *
 * Sólo lo usan `actualizarObservacionesContacto` y el completado "sólo vacíos"
 * de `contacto-write-through.ts`: quien arma el cuerpo es responsable de
 * reenviar `name`, `ivaCondition` e `identificationObject` sin cambiarlos (D1).
 * Mismos cuidados que arriba: el tope de /contacts llega como 400 `{"code":429}`
 * y un timeout aborta con error; quien llama cae a su respaldo.
 */
export async function actualizarContacto(
  id: string,
  body: Record<string, unknown>,
  { timeoutMs = TIMEOUT_PUT_CONTACTO_MS }: { timeoutMs?: number } = {},
) {
  return apiFetch<AlegraContact>(`/contacts/${segmentoId(id)}`, {}, {
    method: "PUT",
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Solo dígitos: "20-12345678-9" y "20.123.456.789" son el mismo documento. */
function digitosDoc(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Formas en que puede estar cargado un documento en Alegra (CUIT, DNI, CPF,
 * CNPJ, CI o RUC), sin repetir: tal cual se tipeó, solo dígitos y, si tiene 11
 * dígitos, como CUIT con guiones. `identification=` compara el texto, así que no
 * se sabe cuál guarda cada contacto. Mismo criterio que el login del portal del
 * CRM (apps/admin, `variantesDocumento`).
 */
export function variantesDocumento(tipeado: string): string[] {
  const digitos = digitosDoc(tipeado);
  const variantes = [tipeado.trim(), digitos];
  if (digitos.length === 11) {
    variantes.push(`${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`);
  }
  return [...new Set(variantes.filter(Boolean))];
}

/**
 * Busca un cliente por su documento (cualquier tipo). Prueba cada variante con
 * el filtro `identification` de Alegra y exige match exacto por dígitos: que un
 * contacto venga en la lista no alcanza. Peor caso: 3 requests.
 */
export async function buscarContactoPorIdentificacion(
  identification: string
): Promise<AlegraContact | null> {
  const buscado = digitosDoc(identification);
  if (!buscado) return null;
  for (const variante of variantesDocumento(identification)) {
    const results = await getContactos({ identification: variante, limit: 5 });
    const match = (Array.isArray(results) ? results : []).find(
      (c) => digitosDoc(c.identification) === buscado
    );
    if (match) return match;
  }
  return null;
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

export async function getItem(id: string) {
  return apiFetch<AlegraItem>(`/items/${segmentoId(id)}`);
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

export async function getFactura(id: string) {
  return apiFetch<AlegraInvoice>(`/invoices/${segmentoId(id)}`);
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
  /** Alícuota de IVA del ítem. null = Alegra no mandó `tax` (ver `ivaPersistible`). */
  ivaPorcentaje: number | null;
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

/**
 * `price` de un ítem de Alegra → la forma que guarda el espejo del Shop
 * (`[{ idPriceList, name, price, main }]`, ids como string). La usan la sync
 * del Shop y la lectura de los precios del CRM, que llegan crudos
 * (`precios_alegra`). Idempotente: aplicada sobre precios ya normalizados
 * devuelve lo mismo.
 */
export function mapPrecios(raw: unknown): AlegraPrice[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((p) => ({
    idPriceList: p?.idPriceList != null ? String(p.idPriceList) : undefined,
    name: p?.name != null ? String(p.name) : undefined,
    price: Number(p?.price ?? 0),
    main: Boolean(p?.main),
  }));
}

export function mapItemRow(raw: Record<string, unknown>): ItemSyncRow {
  const prices = mapPrecios(raw.price);

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
    ivaPorcentaje: ivaPersistible({ tax: raw.tax as AlegraTax[] | undefined }),
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
 * Alícuota de IVA para GUARDAR y EXHIBIR (espejo del catálogo y ficha).
 *
 * Misma suma que `ivaDeItem`, con una diferencia a propósito: sin `tax` devuelve
 * null en vez de `IVA_DEFAULT`. En la cotización el default es una red de
 * seguridad (se corrige al facturar); en la exhibición sería publicar un precio
 * final inventado. null = mostrar el precio como hasta ahora, sin neto.
 */
export function ivaPersistible(item: Pick<AlegraItem, "tax">): number | null {
  if (!Array.isArray(item.tax) || item.tax.length === 0) return null;
  let total = 0;
  let alguno = false;
  for (const t of item.tax) {
    const pct = Number(t?.percentage);
    if (t?.percentage == null || t.percentage === "" || !Number.isFinite(pct)) continue;
    total += pct;
    alguno = true;
  }
  return alguno ? total : null;
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

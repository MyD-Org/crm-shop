import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { identidadActual, idPriceListCliente } from "@/lib/auth";
import {
  COPY_CARRITO,
  validarItemsBody,
  validarVersion,
  type LineaCarrito,
} from "@/lib/carrito-cliente";
import { enriquecer, leerCarrito, mergearCarrito, reemplazarCarrito } from "@/lib/carrito-db";
import { permitir } from "@/lib/rate-limit";

/**
 * Usos por minuto y por usuario, sumando los tres métodos. El cliente agrupa
 * las ráfagas (debounce de 600 ms), así que 120 es holgado para el uso real.
 */
const USOS_POR_MINUTO = 120;
/** Un carrito de 200 entradas cabe de sobra; más que esto es basura. */
const MAX_BYTES_BODY = 16 * 1024;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

const INVALIDO = () => json({ error: COPY_CARRITO.invalido }, 400);

/**
 * Usuario de Clerk que pide, o la respuesta de error (401 / 429). Sólo Clerk:
 * la cookie del CRM no tiene carrito en el servidor. El usuario sale SIEMPRE
 * de la sesión: cualquier `userId` u `owner` del body se ignora.
 */
async function solicitante(): Promise<{ userId: string } | { error: NextResponse }> {
  const { userId } = await auth();
  if (!userId) return { error: json({ error: COPY_CARRITO.noAutorizado }, 401) };
  if (!permitir(`carrito:clerk:${userId}`, USOS_POR_MINUTO, 60_000)) {
    return { error: json({ error: COPY_CARRITO.demasiadas }, 429) };
  }
  return { userId };
}

/** Body JSON acotado a 16 KB, o `undefined` si es inválido o demasiado grande. */
async function leerBody(req: Request): Promise<unknown | undefined> {
  let texto: string;
  try {
    texto = await req.text();
  } catch {
    return undefined;
  }
  if (new TextEncoder().encode(texto).length > MAX_BYTES_BODY) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/**
 * Nombre, marca y precio con la lista de precios del cliente: misma resolución
 * que `api/carrito/cotizar` (el carrito muestra lo mismo que después cotiza).
 */
async function pintar(lineas: readonly LineaCarrito[]) {
  if (lineas.length === 0) return [];
  const { cliente } = await identidadActual();
  const idPriceList = cliente ? await idPriceListCliente(cliente.codigocliente) : undefined;
  return enriquecer(lineas, idPriceList);
}

/** GET /api/carrito → `{ items, version }` (sin carrito: `{ items: [], version: 0 }`). */
export async function GET() {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const carrito = await leerCarrito(s.userId);
  return json({ items: await pintar(carrito.items), version: carrito.version });
}

/**
 * PUT `{ version, items: [{ id, qty }] }` → reemplaza el carrito entero si
 * `version` es la vigente: 200 `{ items, version, avisos }`. Si otro
 * dispositivo escribió antes: 409 `{ error, items, version }` con el actual.
 */
export async function PUT(req: Request) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const body = await leerBody(req);
  const items = validarItemsBody(body);
  const version = validarVersion((body as { version?: unknown } | null)?.version);
  if (!items || version === null) return INVALIDO();

  const r = await reemplazarCarrito(s.userId, version, items);
  if (!r.ok) {
    return json(
      {
        error: COPY_CARRITO.otroDispositivo,
        items: await pintar(r.actual.items),
        version: r.actual.version,
      },
      409,
    );
  }
  return json({
    items: await pintar(r.carrito.items),
    version: r.carrito.version,
    avisos: r.avisos,
  });
}

/**
 * POST `{ items: [{ id, qty }] }` → une el carrito de invitado con el del
 * servidor (cantidad máxima por producto): 200 `{ items, version, avisos }`.
 */
export async function POST(req: Request) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const items = validarItemsBody(await leerBody(req));
  if (!items) return INVALIDO();

  const r = await mergearCarrito(s.userId, items);
  return json({ items: await pintar(r.items), version: r.version, avisos: r.avisos });
}

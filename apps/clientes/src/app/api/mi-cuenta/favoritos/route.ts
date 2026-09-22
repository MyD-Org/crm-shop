import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  agregarFavorito,
  FavoritosLlenosError,
  idsFavoritos,
  MAX_FAVORITOS,
  quitarFavorito,
} from "@/lib/favoritos";
import { permitir } from "@/lib/rate-limit";

// Datos por usuario: nunca prerenderizar ni cachear.
export const dynamic = "force-dynamic";

/** Usos por minuto y por usuario, sumando los tres métodos. */
const USOS_POR_MINUTO = 60;
/** Largo máximo del id de Alegra que se acepta (los reales son numéricos cortos). */
const MAX_LARGO_ID = 64;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

/**
 * Usuario de Clerk que pide, o la respuesta de error (401 / 429). Sólo Clerk:
 * un visitante con la cookie del CRM no tiene dónde guardar favoritos.
 */
async function solicitante(): Promise<{ userId: string } | { error: NextResponse }> {
  const { userId } = await auth();
  if (!userId) return { error: json({ error: "No autorizado" }, 401) };
  if (!permitir(`favoritos:clerk:${userId}`, USOS_POR_MINUTO, 60_000)) {
    return {
      error: json({ error: "Demasiadas solicitudes. Inténtelo de nuevo en unos minutos." }, 429),
    };
  }
  return { userId };
}

/** `alegraItemId` del body, o `null` si falta o no es válido. */
async function itemDelBody(req: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  const id = (body as { alegraItemId?: unknown } | null)?.alegraItemId;
  if (typeof id !== "string") return null;
  const limpio = id.trim();
  return limpio && limpio.length <= MAX_LARGO_ID ? limpio : null;
}

const SIN_PRODUCTO = () => json({ error: "Indique el producto." }, 400);

/** GET /api/mi-cuenta/favoritos → `{ ids }` del usuario, del más nuevo al más viejo. */
export async function GET() {
  const s = await solicitante();
  if ("error" in s) return s.error;
  return json({ ids: await idsFavoritos(s.userId) });
}

/** PUT `{ alegraItemId }` → guarda (idempotente). */
export async function PUT(req: Request) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const id = await itemDelBody(req);
  if (!id) return SIN_PRODUCTO();
  try {
    await agregarFavorito(s.userId, id);
  } catch (err) {
    if (err instanceof FavoritosLlenosError) {
      return json({ error: `Alcanzó el máximo de ${MAX_FAVORITOS} favoritos.` }, 422);
    }
    throw err;
  }
  return json({ ok: true });
}

/** DELETE `{ alegraItemId }` → quita (idempotente). */
export async function DELETE(req: Request) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const id = await itemDelBody(req);
  if (!id) return SIN_PRODUCTO();
  await quitarFavorito(s.userId, id);
  return json({ ok: true });
}

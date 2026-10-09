import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { agregarFavoritosLote, MAX_FAVORITOS } from "@/lib/favoritos";
import { esIdAlegra } from "@/lib/alegra";
import { getProductosPorIds } from "@/lib/catalog";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import { permitirAsync } from "@/lib/rate-limit";

/** Altas masivas por minuto y por usuario (aparte de los 60/min de los toggles). */
const LIMITE_LOTE_POR_MIN = 5;
/** Largo máximo del id de Alegra que se acepta (los reales son numéricos cortos). */
const MAX_LARGO_ID = 64;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

const SIN_PRODUCTOS = () => json({ error: "Indique los productos." }, 400);

/**
 * POST `{ alegraItemIds: string[] }` → guarda de una vez los productos de una
 * lista compartida. Sólo Clerk. Idempotente; si no entran todos por el tope se
 * guardan los que entren (200, nunca 422). Los ids que el catálogo no vende hoy
 * (ocultos, inactivos, inexistentes) no se guardan y se cuentan en
 * `noDisponibles`.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "No autorizado" }, 401);
  if (!await permitirAsync(`favoritos-lote:clerk:${userId}`, LIMITE_LOTE_POR_MIN, 60_000)) {
    return json({ error: "Demasiadas solicitudes. Inténtelo de nuevo en unos minutos." }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return SIN_PRODUCTOS();
  }
  const crudos = (body as { alegraItemIds?: unknown } | null)?.alegraItemIds;
  if (!Array.isArray(crudos) || crudos.length === 0 || crudos.length > MAX_FAVORITOS) {
    return SIN_PRODUCTOS();
  }

  const ids = [
    ...new Set(
      crudos.flatMap((x) => {
        const id = typeof x === "string" ? x.trim() : "";
        return esIdAlegra(id) && id.length <= MAX_LARGO_ID ? [id] : [];
      }),
    ),
  ];
  if (ids.length === 0) return SIN_PRODUCTOS();

  const productos = await getProductosPorIds(ids, {
    soloActivos: true,
    soloVisibles: await catalogoSoloVisibles(),
  });
  const disponibles = ids.filter((id) => productos.has(id));
  const noDisponibles = ids.length - disponibles.length;

  const r = await agregarFavoritosLote(userId, disponibles);
  return json({
    ok: true,
    ids: r.ids,
    agregados: r.agregados.length,
    yaEstaban: r.yaEstaban,
    sinLugar: r.sinLugar,
    noDisponibles,
  });
}

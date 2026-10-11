// src/app/api/internal/marketing/interacciones/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { obtenerPieza } from "@/lib/marketing/piezas-repo"
import { guardarInteraccion, listarInteracciones, type NuevaInteraccion } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"
const ORIGENES = ["comentario", "dm", "mencion", "resena_google"]
const CATEGORIAS = ["consulta", "asesoramiento", "elogio", "queja", "spam", "otro"]
const SENTIMIENTOS = ["positivo", "neutro", "negativo"]

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["aiapi"])
  if (!auth.ok) return auth.response
  const estado = new URL(req.url).searchParams.get("estado") ?? undefined
  return jsonInterno({ items: await listarInteracciones(auth.tenantId, estado) })
}

export async function POST(req: Request) {
  const auth = autenticarInterno(req, ["aiapi"])
  if (!auth.ok) return auth.response
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return jsonInterno({ error: "invalid_json" }, 400)
  if (!ORIGENES.includes(String(b.origen))) return jsonInterno({ error: "invalid_origen" }, 400)
  if (!CATEGORIAS.includes(String(b.categoria))) return jsonInterno({ error: "invalid_categoria" }, 400)
  if (!SENTIMIENTOS.includes(String(b.sentimiento ?? "neutro"))) return jsonInterno({ error: "invalid_sentimiento" }, 400)
  if (typeof b.externoId !== "string" || !b.externoId || typeof b.texto !== "string" || !b.texto.trim()) return jsonInterno({ error: "invalid_interaccion" }, 400)
  // piezaId opcional: si viene, tiene que ser una pieza de este tenant (evita 500 por cast/FK).
  if (b.piezaId !== undefined && b.piezaId !== null && (typeof b.piezaId !== "string" || !(await obtenerPieza(auth.tenantId, b.piezaId)))) {
    return jsonInterno({ error: "invalid_piezaId" }, 400)
  }
  const i = await guardarInteraccion(auth.tenantId, {
    origen: b.origen as NuevaInteraccion["origen"],
    externoId: b.externoId,
    piezaId: typeof b.piezaId === "string" ? b.piezaId : null,
    autor: String(b.autor ?? "").slice(0, 200),
    texto: b.texto.slice(0, 4000),
    categoria: b.categoria as NuevaInteraccion["categoria"],
    sentimiento: (b.sentimiento ?? "neutro") as NuevaInteraccion["sentimiento"],
    respuestaSugerida: String(b.respuestaSugerida ?? "").slice(0, 2000),
  })
  return jsonInterno(i, 201)
}

import { esIdDireccion } from "@/lib/direcciones-envio";
import { listarDirecciones, marcarPredeterminada } from "@/lib/direcciones-envio-db";
import { json, noEncontrada, solicitante, type ContextoId } from "@/lib/direcciones-envio-api";

/** POST sin cuerpo: deja esta dirección como la predeterminada → `{ direcciones }`. */
export async function POST(_req: Request, ctx: ContextoId) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const { id } = await ctx.params;
  if (!esIdDireccion(id) || !(await marcarPredeterminada(s.userId, id))) return noEncontrada();
  return json({ direcciones: await listarDirecciones(s.userId) });
}

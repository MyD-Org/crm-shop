import { esIdDireccion } from "@/lib/direcciones-envio";
import {
  actualizarDireccion,
  eliminarDireccion,
  listarDirecciones,
} from "@/lib/direcciones-envio-db";
import {
  datosDelCuerpo,
  json,
  noEncontrada,
  solicitante,
  type ContextoId,
} from "@/lib/direcciones-envio-api";

export const dynamic = "force-dynamic";

/** PUT: reemplaza los datos de una dirección del usuario → `{ direccion, direcciones }`. */
export async function PUT(req: Request, ctx: ContextoId) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const { id } = await ctx.params;
  if (!esIdDireccion(id)) return noEncontrada();
  const d = await datosDelCuerpo(req);
  if ("error" in d) return d.error;
  const direccion = await actualizarDireccion(s.userId, id, d.datos);
  if (!direccion) return noEncontrada();
  return json({ direccion, direcciones: await listarDirecciones(s.userId) });
}

/** DELETE: borra (si era la predeterminada, la pasa a la más reciente) → `{ direcciones }`. */
export async function DELETE(_req: Request, ctx: ContextoId) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const { id } = await ctx.params;
  if (!esIdDireccion(id) || !(await eliminarDireccion(s.userId, id))) return noEncontrada();
  return json({ direcciones: await listarDirecciones(s.userId) });
}

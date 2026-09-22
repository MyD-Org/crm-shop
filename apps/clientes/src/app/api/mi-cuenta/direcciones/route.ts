import { crearDireccion, DireccionesLlenasError, listarDirecciones } from "@/lib/direcciones-envio-db";
import { datosDelCuerpo, direccionesLlenas, json, solicitante } from "@/lib/direcciones-envio-api";

// Datos por usuario: nunca prerenderizar ni cachear.
export const dynamic = "force-dynamic";

/** GET → `{ direcciones }`: la predeterminada primero, después la más nueva. */
export async function GET() {
  const s = await solicitante();
  if ("error" in s) return s.error;
  return json({ direcciones: await listarDirecciones(s.userId) });
}

/** POST `{ etiqueta?, calle, ciudad, provincia, cp, referencias?, predeterminada? }` → 201. */
export async function POST(req: Request) {
  const s = await solicitante();
  if ("error" in s) return s.error;
  const d = await datosDelCuerpo(req);
  if ("error" in d) return d.error;
  let direccion;
  try {
    direccion = await crearDireccion(s.userId, d.datos);
  } catch (err) {
    if (err instanceof DireccionesLlenasError) return direccionesLlenas();
    throw err;
  }
  return json({ direccion, direcciones: await listarDirecciones(s.userId) }, 201);
}

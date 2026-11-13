/**
 * IP de quien hace el request, para las claves de rate limit del invitado (`inv:ip:<ip>`). SOLO
 * servidor.
 *
 * Primera IP de `x-forwarded-for` (la pone Vercel); si no, `x-real-ip`. Un valor que no parece una IP
 * se descarta: va a parar a una clave de Redis y no debe poder inflarla con basura. Hay otras copias
 * de esta lógica en el repo (cotizar, ai-token, chat-ia, ubicacion-api); no se tocan acá.
 */
const PARECE_IP = /^[0-9a-fA-F:.]{2,45}$/;

function candidata(valor: string | null): string | null {
  const v = valor?.split(",")[0]?.trim();
  return v && PARECE_IP.test(v) ? v : null;
}

export function ipDelRequest(req: Request): string | null {
  return candidata(req.headers.get("x-forwarded-for")) ?? candidata(req.headers.get("x-real-ip"));
}

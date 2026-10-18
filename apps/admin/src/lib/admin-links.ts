// Base de los links que el CRM manda por mail (invitación, recuperar contraseña).
//
// Sale del HOST del request, nunca de una URL fija: cada empresa vive en su subdominio y el
// login busca el usuario en el tenant del host. Un link a otro host (p. ej. un
// NEXT_PUBLIC_BASE_URL de cuando había un solo tenant) deja al usuario definiendo la clave
// bien y entrando después por el login de OTRA empresa, que contesta "Credenciales incorrectas".
export function adminLinkBase(req: Request): string {
  const url = new URL(req.url)
  const host = req.headers.get("host") ?? url.host
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "")
  return `${proto}://${host}`
}

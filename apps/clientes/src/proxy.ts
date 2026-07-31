import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const user = process.env.SITE_AUTH_USER;
  const pass = process.env.SITE_AUTH_PASSWORD;

  // Sin credenciales configuradas, no se bloquea el acceso.
  if (!user || !pass) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const separatorIndex = decoded.indexOf(":");
    const reqUser = decoded.slice(0, separatorIndex);
    const reqPass = decoded.slice(separatorIndex + 1);

    if (reqUser === user && reqPass === pass) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Autenticación requerida", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Acceso restringido"' },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

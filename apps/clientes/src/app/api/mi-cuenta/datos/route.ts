import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function PATCH(req: Request) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const { razonsocial, email } = body as { razonsocial?: string; email?: string };

  if (razonsocial !== undefined) {
    session.razonsocial = razonsocial.trim() || session.razonsocial;
  }
  if (email !== undefined) {
    session.email = email.trim() || session.email;
  }

  await session.save();

  return NextResponse.json({ ok: true });
}

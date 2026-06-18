import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { MisCompras } from "@/components/MisCompras";
import { Footer } from "@/components/Footer";

export default async function MiCuentaPage() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (!session.isLoggedIn) {
    redirect("/ingresar");
  }

  return (
    <>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <MisCompras
          nombre={session.razonsocial ?? session.email ?? "cliente"}
          cuit={session.cuit}
          email={session.email}
          esCuentaCorriente={session.tipoCuenta === "corriente"}
        />
      </main>
      <Footer />
    </>
  );
}

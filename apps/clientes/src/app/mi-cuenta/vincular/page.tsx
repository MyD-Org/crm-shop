import Link from "next/link";
import { redirect } from "next/navigation";
import { Footer } from "@/components/Footer";
import { VincularClient } from "@/components/VincularClient";
import { identidadActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function VincularPage() {
  const { clerkUserId, cliente } = await identidadActual();

  // Vincular exige sesión de Clerk: la vinculación se ata a una cuenta de
  // acceso concreta, y una cookie heredada del CRM no identifica ninguna.
  if (!clerkUserId) redirect("/ingresar");

  return (
    <>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <nav className="mb-6 text-sm text-muted">
          <Link href="/mi-cuenta" className="hover:text-primary">Mi cuenta</Link>
          <span className="px-1.5">/</span>
          <span className="text-text">Vincular cuenta corriente</span>
        </nav>

        <h1 className="text-2xl font-extrabold text-text">Vinculá tu cuenta corriente</h1>
        <p className="mt-2 text-sm text-muted">
          Si ya sos cliente del local, vinculá tu cuenta para ver{" "}
          <span className="font-medium text-text">tus precios</span> y el estado
          de tu cuenta corriente. Si no, podés seguir comprando a precio de lista
          sin hacer nada.
        </p>

        <div className="mt-6">
          {cliente ? (
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-base font-bold text-text">Ya estás vinculado</h2>
              <p className="mt-1 text-sm text-muted">
                Tu usuario está asociado a{" "}
                <span className="font-semibold text-text">
                  {cliente.razonsocial ?? cliente.codigocliente}
                </span>
                {cliente.cuit ? ` (CUIT ${cliente.cuit})` : ""}. Si no
                corresponde, escribinos y lo corregimos.
              </p>
              <Link href="/mi-cuenta" className="mt-4 inline-block">
                <span className="text-sm font-semibold text-primary hover:underline">
                  Volver a mi cuenta
                </span>
              </Link>
            </div>
          ) : (
            <VincularClient />
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

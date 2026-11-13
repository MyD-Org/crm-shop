import { ClerkLoaded, ClerkLoading, SignUp } from "@clerk/nextjs";
import { FormularioClerkCargando } from "@/components/FormularioClerkCargando";
import { FondoPiedra } from "@/components/piedra/FondoPiedra";
import { EventoIngresoPantalla } from "@/components/tracking/EventoIngresoPantalla";
import { getDecoracion } from "@/lib/home-datos";
import { getMarca } from "@/lib/marca";

/** Alta de cuenta. Ver la nota sobre el catch-all en /ingresar. */
export default async function RegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  // `?email=` (mail y confirmación del invitado): precarga el correo. Sólo si parece un email.
  const { email } = await searchParams;
  const emailInicial = typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254 ? email : undefined;
  const [{ nombre }, { piedra }] = await Promise.all([getMarca(), getDecoracion()]);
  return (
    <FondoPiedra piedra={piedra}>
      <EventoIngresoPantalla />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-text">Cree su cuenta</h1>
          <p className="mt-2 text-sm text-muted">
            Si ya es cliente de {nombre}, después podrá vincular su cuenta
            para comprar con sus precios y condiciones de cliente.
          </p>
        </div>
        <ClerkLoading>
          <FormularioClerkCargando />
        </ClerkLoading>
        <ClerkLoaded>
          <SignUp
            fallbackRedirectUrl="/"
            signInFallbackRedirectUrl="/"
            {...(emailInicial ? { initialValues: { emailAddress: emailInicial } } : {})}
          />
        </ClerkLoaded>
      </main>
    </FondoPiedra>
  );
}

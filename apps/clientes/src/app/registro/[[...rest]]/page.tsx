import { SignUp } from "@clerk/nextjs";

/** Alta de cuenta. Ver la nota sobre el catch-all en /ingresar. */
export default function RegistroPage() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-text">Cree su cuenta</h1>
          <p className="mt-2 text-sm text-muted">
            Si ya es cliente de Central LED, después podrá vincular su cuenta
            para comprar con sus precios y condiciones de cliente.
          </p>
        </div>
        <SignUp fallbackRedirectUrl="/" signInFallbackRedirectUrl="/" />
      </main>
    </>
  );
}

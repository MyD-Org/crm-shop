import { SignIn } from "@clerk/nextjs";
import { Footer } from "@/components/Footer";

/**
 * Login del shop.
 *
 * Catch-all opcional (`[[...rest]]`) porque Clerk usa sub-rutas propias para los
 * pasos del flujo (verificación, SSO callback, factor-two). Con una `page.tsx`
 * plana, cualquiera de esos pasos daría 404 a mitad del login.
 *
 * La URL queda en castellano a propósito: es la que ve el cliente. El mapeo con
 * lo que Clerk espera se hace por env (NEXT_PUBLIC_CLERK_SIGN_IN_URL).
 */
export default function IngresarPage() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-text">Ingresá a tu cuenta</h1>
          <p className="mt-2 text-sm text-muted">
            Para ver tus precios, tu cuenta corriente y tus pedidos.
          </p>
        </div>
        <SignIn />
      </main>
      <Footer />
    </>
  );
}

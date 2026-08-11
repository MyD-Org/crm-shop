import { redirect } from "next/navigation";
import { CheckoutClient } from "@/components/CheckoutClient";
import { Footer } from "@/components/Footer";
import { identidadActual } from "@/lib/auth";
import { getPerfilFacturacion, perfilCompleto } from "@/lib/facturacion-db";

/**
 * El checkout exige estar logueado, pero NO tener cuenta corriente vinculada:
 * quien no vinculó compra a lista general (decisión de producto). Se corta acá,
 * en el servidor, para que la página nunca renderice sin identidad.
 */
export default async function CheckoutPage() {
  const { clerkUserId, cliente, nombre, email } = await identidadActual();
  if (!clerkUserId && !cliente) {
    redirect("/ingresar");
  }

  // Sin datos fiscales no se puede facturar la compra. Se resuelve acá y se
  // avisa arriba de todo, en vez de dejar que llene el formulario entero y
  // recién rebote contra el 409 al apretar "Confirmar".
  const perfil = clerkUserId ? await getPerfilFacturacion(clerkUserId) : null;

  return (
    <>
      <CheckoutClient
        nombreSugerido={
          perfil?.razonSocial ?? cliente?.razonsocial ?? nombre ?? ""
        }
        emailCliente={cliente?.email ?? email}
        facturacionCompleta={perfilCompleto(perfil)}
      />
      <Footer />
    </>
  );
}

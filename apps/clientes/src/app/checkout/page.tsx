import { redirect } from "next/navigation";
import { rutaIngreso } from "@/lib/ingreso";
import { CheckoutClient } from "@/components/CheckoutClient";
import { identidadActual } from "@/lib/auth";
import { admiteEnvio } from "@/lib/facturacion";
import { getPerfilFacturacion, perfilCompleto } from "@/lib/facturacion-db";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { pagosHabilitados } from "@/lib/pagos-flag";

/**
 * El checkout exige estar logueado, pero NO tener cuenta corriente vinculada:
 * quien no vinculó compra a lista general (decisión de producto). Se corta acá,
 * en el servidor, para que la página nunca renderice sin identidad.
 */
export default async function CheckoutPage() {
  const { clerkUserId, cliente, nombre, email } = await identidadActual();
  if (!clerkUserId && !cliente) {
    redirect(rutaIngreso("/checkout"));
  }

  // Sin datos fiscales no se puede facturar la compra. Se resuelve acá y se
  // avisa arriba de todo, en vez de dejar que llene el formulario entero y
  // recién rebote contra el 409 al apretar "Confirmar".
  // En paralelo con la oferta de cuotas (null = sin cuotas: flag off, sin datos o error).
  //
  // El flag de pagos se lee acá, en el server, y al checkout le llega como
  // booleano. Apagado, la oferta de cuotas ni se consulta: sin "Forma de pago"
  // no hay dónde mostrarla.
  const pagos = pagosHabilitados();
  const [perfil, oferta] = await Promise.all([
    clerkUserId ? getPerfilFacturacion(clerkUserId) : null,
    pagos ? getOfertaCuotas() : null,
  ]);

  return (
    <>
      <CheckoutClient
        nombreSugerido={
          perfil?.razonSocial ?? cliente?.razonsocial ?? nombre ?? ""
        }
        telefonoSugerido={perfil?.telefono ?? ""}
        emailCliente={cliente?.email ?? email}
        facturacionCompleta={perfilCompleto(perfil)}
        admiteEnvio={admiteEnvio(perfil?.pais)}
        oferta={oferta}
        pagosHabilitados={pagos}
      />
    </>
  );
}

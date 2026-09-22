import { redirect } from "next/navigation";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { DatosCuenta } from "@/components/mi-cuenta/DatosCuenta";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { identidadActual } from "@/lib/auth";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

export const dynamic = "force-dynamic";

/**
 * Mis datos: datos personales (Clerk, en lectura) y de facturación. Con la cookie heredada del CRM y sin sesión de Clerk no hay
 * perfil posible (el perfil se ata al usuario de Clerk): no se muestran
 * formularios, se invita a iniciar sesión.
 */
export default async function DatosPage() {
  const { clerkUserId, cliente, email, nombre } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.datos));

  if (!clerkUserId) {
    return (
      <section>
        <SeccionTitulo titulo="Mis datos" />
        <EmptyState
          title="Inicie sesión con su usuario para administrar sus datos."
          action={<BotonEnlace href={rutaIngreso(RUTAS_MI_CUENTA.datos)}>Iniciar sesión</BotonEnlace>}
        />
      </section>
    );
  }

  const perfil = await getPerfilFacturacion(clerkUserId);

  return (
    <section>
      <SeccionTitulo titulo="Mis datos" />
      <DatosCuenta
        nombre={nombre}
        // Datos personales = los de Clerk (el correo con el que ingresa).
        email={email}
        perfilFacturacion={perfil}
        // Hay razón social vinculada sólo si vino de una vinculación propia o
        // del CRM: sin cliente, compra a lista general y se le ofrece vincular.
        razonSocialVinculada={cliente ? (cliente.razonsocial ?? cliente.codigocliente) : undefined}
        cuit={cliente?.cuit}
        esCuentaCorriente={cliente?.tipoCuenta === "corriente"}
      />
    </section>
  );
}

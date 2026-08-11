import { redirect } from "next/navigation";
import { MisCompras } from "@/components/MisCompras";
import { Footer } from "@/components/Footer";
import { identidadActual } from "@/lib/auth";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { listarPedidos, resumenPedidos } from "@/lib/pedidos";

// Los pedidos cambian con cada compra: nunca prerenderizar esta página.
export const dynamic = "force-dynamic";

export default async function MiCuentaPage() {
  const { clerkUserId, cliente, nombre, email } = await identidadActual();
  if (!clerkUserId && !cliente) {
    redirect("/ingresar");
  }

  const dueno = { clerkUserId, clienteCodigo: cliente?.codigocliente };
  const [pedidos, resumen, perfilFacturacion] = await Promise.all([
    listarPedidos(dueno),
    resumenPedidos(dueno),
    clerkUserId ? getPerfilFacturacion(clerkUserId) : null,
  ]);

  return (
    <>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <MisCompras
          nombre={cliente?.razonsocial ?? nombre ?? email ?? "cliente"}
          cuit={cliente?.cuit}
          email={cliente?.email ?? email}
          esCuentaCorriente={cliente?.tipoCuenta === "corriente"}
          // Solo hay razón social vinculada si vino de una vinculación propia:
          // la cookie heredada del CRM identifica al cliente pero no crea
          // vínculo, y ofrecerle "vincular" a quien ya entró por el CRM sería
          // pedirle que pruebe algo que ya probó.
          razonSocialVinculada={
            cliente
              ? cliente.razonsocial ?? cliente.codigocliente
              : undefined
          }
          perfilFacturacion={perfilFacturacion}
          pedidos={pedidos}
          resumen={resumen}
        />
      </main>
      <Footer />
    </>
  );
}

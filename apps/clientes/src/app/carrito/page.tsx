import { CarritoClient } from "@/components/CarritoClient";
import { identidadActual } from "@/lib/auth";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { entregaDelCarrito } from "@/lib/entrega-eleccion";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { opcionesCheckoutDelVisitante } from "@/lib/zona-servidor";

export default async function CarritoPage() {
  const [{ clerkUserId, cliente }, reglas] = await Promise.all([
    identidadActual(),
    reglasVentaCacheadas(),
  ]);
  // Elección única: retiro => cotiza como retiro, sin provincia (sin envío ni barra de envío gratis);
  // envío => cotiza a la provincia elegida; sin elección o si la lectura falla => como siempre.
  const eleccion = (await ubicacionDelVisitante().catch(() => null))?.eleccion ?? { tipo: "ninguna" as const };
  const { entregaTipo, provincia, ubicacionConocida } = entregaDelCarrito(eleccion);
  // Con retiro (flag `sucursales`): el mismo local con el que arranca el checkout (`localInicial`: el
  // elegido si admite retiro, si no el de la zona o la predeterminada), así el carrito y el checkout
  // marcan las mismas líneas "a pedido". Sin el flag o si falla, el servidor elige como siempre.
  const sucursalRetiro =
    entregaTipo === "retiro" ? ((await opcionesCheckoutDelVisitante().catch(() => null))?.localInicial ?? null) : null;
  return (
    <CarritoClient
      conSesion={!!(clerkUserId || cliente)}
      configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
      entregaTipo={entregaTipo}
      sucursalRetiro={sucursalRetiro}
      provincia={provincia}
      ubicacionConocida={ubicacionConocida}
    />
  );
}

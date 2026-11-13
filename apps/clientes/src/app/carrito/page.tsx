import { CarritoClient } from "@/components/CarritoClient";
import { identidadActual } from "@/lib/auth";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { entregaDelCarrito } from "@/lib/entrega-eleccion";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { getDecoracion } from "@/lib/home-datos";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { opcionesCheckoutDelVisitante } from "@/lib/zona-servidor";
import { mediosOfrecibles } from "@/lib/medios-pago-datos";
import { esCompradorCuentaCorriente } from "@/lib/medios-pago";
import { SLUG_TRANSFERENCIA } from "@/lib/cuentas-bancarias";
import { pagoParaCotizar } from "@/lib/lista-medio";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { compraInvitadoHabilitada } from "@/lib/compra-invitado-flag";

export default async function CarritoPage() {
  const [{ clerkUserId, cliente }, reglas, { piedra }] = await Promise.all([
    identidadActual(),
    reglasVentaCacheadas(),
    getDecoracion(),
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
  // Precio con transferencia: el carrito cotiza con la lista de ese medio (si está activo, aplica a la
  // modalidad y tiene lista propia). Cuenta corriente o lista privada no: su precio no depende del medio.
  const precioPropio =
    esCompradorCuentaCorriente(cliente) || (cliente ? Boolean(await listaPrivadaDelComprador().catch(() => null)) : false);
  const medios = precioPropio ? [] : await mediosOfrecibles().catch(() => []);
  const transferencia = medios.find((m) => m.slug === SLUG_TRANSFERENCIA && m.activo) ?? null;
  const pago = transferencia ? pagoParaCotizar(medios, entregaTipo, transferencia) : null;
  const pagoTransferencia = pago?.pagoMetodo ? { listaKey: pago.listaKey, pagoMetodo: pago.pagoMetodo } : null;
  // Compra sin cuenta (flag `compra-invitado`): se evalúa sólo para quien no tiene sesión.
  const compraInvitado = !(clerkUserId || cliente) && (await compraInvitadoHabilitada());
  return (
    <CarritoClient
      pagoTransferencia={pagoTransferencia}
      conSesion={!!(clerkUserId || cliente)}
      compraInvitado={compraInvitado}
      configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
      entregaTipo={entregaTipo}
      sucursalRetiro={sucursalRetiro}
      provincia={provincia}
      ubicacionConocida={ubicacionConocida}
      piedra={piedra}
    />
  );
}

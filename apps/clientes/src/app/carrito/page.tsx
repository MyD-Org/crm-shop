import { CarritoClient } from "@/components/CarritoClient";
import { identidadActual } from "@/lib/auth";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { ubicacionExactaVerificada } from "@/lib/ubicacion-exacta";
import { claveProvincia } from "@/lib/sucursales";
import { entregaDelCarrito } from "@/lib/entrega-eleccion";
import { CONFIG_ENVIO_DEFAULT, configEnvioPublica } from "@/lib/envio";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { getDecoracion } from "@/lib/home-datos";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { opcionesCheckoutDelVisitante } from "@/lib/zona-servidor";
import { compraInvitadoHabilitada } from "@/lib/compra-invitado-flag";
import { pagoTransferenciaDelVisitante } from "@/lib/pago-transferencia-servidor";

export default async function CarritoPage() {
  const [{ clerkUserId, cliente }, reglas, { piedra }] = await Promise.all([
    identidadActual(),
    // Flag `envio-por-zona`: prendido, la config trae los métodos (para saber si se anticipa la tarifa).
    envioPorZonaHabilitado().then((envioZona) => reglasVentaCacheadas(envioZona)),
    getDecoracion(),
  ]);
  // Elección única: retiro => cotiza como retiro, sin provincia (sin envío ni barra de envío gratis);
  // envío => cotiza a la provincia elegida; sin elección o si la lectura falla => como siempre.
  const resuelta = await ubicacionDelVisitante().catch(() => null);
  const eleccion = resuelta?.eleccion ?? { tipo: "ninguna" as const };
  const { entregaTipo, provincia, ubicacionConocida } = entregaDelCarrito(eleccion);
  // Con retiro (flag `sucursales`): el mismo local con el que arranca el checkout (`localInicial`: el
  // elegido si admite retiro, si no el de la zona o la predeterminada), así el carrito y el checkout
  // marcan las mismas líneas "a pedido". Sin el flag o si falla, el servidor elige como siempre.
  const sucursalRetiro =
    entregaTipo === "retiro" ? ((await opcionesCheckoutDelVisitante().catch(() => null))?.localInicial ?? null) : null;
  // Precio con transferencia: el carrito cotiza con la lista de ese medio (si está activo, aplica a la
  // modalidad y tiene lista propia). Cuenta corriente o lista privada no: su precio no depende del medio.
  const pagoTransferencia = await pagoTransferenciaDelVisitante(cliente, entregaTipo);
  const configEnvio = reglas.envio ?? CONFIG_ENVIO_DEFAULT;
  // Envío por zona: sólo con métodos cargados se manda la localidad para anticipar la tarifa.
  // Con «Usar mi ubicación» y un punto firmado vigente viaja también el token con su calle: el servidor lo
  // verifica y cotiza la zona exacta (las coordenadas van sólo dentro del token).
  const exacta =
    entregaTipo === "envio" && (configEnvio.metodos?.length ?? 0) > 0 && resuelta
      ? ubicacionExactaVerificada(resuelta.eleccion, claveProvincia(resuelta.ubicacion?.provincia) || null)
      : null;
  const destinoEnvio =
    entregaTipo === "envio" && (configEnvio.metodos?.length ?? 0) > 0 && resuelta?.ubicacion
      ? {
          localidad: resuelta.ubicacion.localidad,
          ...(resuelta.ubicacion.id ? { georefId: resuelta.ubicacion.id } : {}),
          ...(exacta ? { geoToken: exacta.geoToken, calle: exacta.calle, ...(exacta.cp ? { cp: exacta.cp } : {}) } : {}),
        }
      : undefined;
  // Compra sin cuenta (flag `compra-invitado`): se evalúa sólo para quien no tiene sesión.
  const compraInvitado = !(clerkUserId || cliente) && (await compraInvitadoHabilitada());
  return (
    <CarritoClient
      pagoTransferencia={pagoTransferencia}
      conSesion={!!(clerkUserId || cliente)}
      compraInvitado={compraInvitado}
      configEnvio={configEnvioPublica(configEnvio)}
      destinoEnvio={destinoEnvio}
      entregaTipo={entregaTipo}
      sucursalRetiro={sucursalRetiro}
      provincia={provincia}
      ubicacionConocida={ubicacionConocida}
      piedra={piedra}
    />
  );
}

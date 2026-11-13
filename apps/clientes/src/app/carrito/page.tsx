import { CarritoClient } from "@/components/CarritoClient";
import { identidadActual } from "@/lib/auth";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { entregaDelCarrito } from "@/lib/entrega-eleccion";
import { CONFIG_ENVIO_DEFAULT, configEnvioPublica } from "@/lib/envio";
import { envioPorZonaHabilitado } from "@/lib/envio-zona-flag";
import { getDecoracion } from "@/lib/home-datos";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { opcionesCheckoutDelVisitante } from "@/lib/zona-servidor";
import { mediosOfrecibles } from "@/lib/medios-pago-datos";
import { esCompradorCuentaCorriente } from "@/lib/medios-pago";
import { SLUG_TRANSFERENCIA } from "@/lib/cuentas-bancarias";
import { pagoParaCotizar } from "@/lib/lista-medio";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";

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
  const precioPropio =
    esCompradorCuentaCorriente(cliente) || (cliente ? Boolean(await listaPrivadaDelComprador().catch(() => null)) : false);
  const medios = precioPropio ? [] : await mediosOfrecibles().catch(() => []);
  const transferencia = medios.find((m) => m.slug === SLUG_TRANSFERENCIA && m.activo) ?? null;
  const pago = transferencia ? pagoParaCotizar(medios, entregaTipo, transferencia) : null;
  const pagoTransferencia = pago?.pagoMetodo ? { listaKey: pago.listaKey, pagoMetodo: pago.pagoMetodo } : null;
  const configEnvio = reglas.envio ?? CONFIG_ENVIO_DEFAULT;
  // Envío por zona: sólo con métodos cargados se manda la localidad para anticipar la tarifa.
  const destinoEnvio =
    entregaTipo === "envio" && (configEnvio.metodos?.length ?? 0) > 0 && resuelta?.ubicacion
      ? { localidad: resuelta.ubicacion.localidad, ...(resuelta.ubicacion.id ? { georefId: resuelta.ubicacion.id } : {}) }
      : undefined;
  return (
    <CarritoClient
      pagoTransferencia={pagoTransferencia}
      conSesion={!!(clerkUserId || cliente)}
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

import { redirect } from "next/navigation";
import { rutaIngreso } from "@/lib/ingreso";
import { CheckoutClient } from "@/components/CheckoutClient";
import { identidadActual } from "@/lib/auth";
import { admiteEnvio } from "@/lib/facturacion";
import { datosDelContacto, paraElCliente } from "@/lib/datos-del-contacto";
import { telefonoDelCheckout } from "@/lib/contacto-alegra";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { listarDirecciones } from "@/lib/direcciones-envio-db";
import type { DireccionEnvio } from "@/lib/direcciones-envio";
import { opcionesCheckoutDelVisitante } from "@/lib/zona-servidor";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import type { EleccionInicialCheckout } from "@/lib/checkout-ubicacion";
import type { EleccionUbicacion } from "@/lib/ubicacion";
import { mediosOfrecibles } from "@/lib/medios-pago-datos";
import { esCompradorCuentaCorriente, mediosVisiblesPara } from "@/lib/medios-pago";

/**
 * Direcciones guardadas para precargar el envío. Si la consulta falla (por
 * ejemplo, `0003` todavía sin aplicar) el checkout sigue como antes, sin
 * direcciones: comprar importa más que la precarga.
 */
async function direccionesParaCheckout(
  clerkUserId: string,
): Promise<DireccionEnvio[]> {
  try {
    return await listarDirecciones(clerkUserId);
  } catch (err) {
    console.error(
      "[checkout] no se pudieron leer las direcciones guardadas:",
      err,
    );
    return [];
  }
}

/** Solo identificadores: la elección de «Enviar a» ya validada contra el dueño y los locales. */
function eleccionParaCheckout(e: EleccionUbicacion): EleccionInicialCheckout {
  if (e.tipo === "retiro") return { tipo: "retiro", sucursal: e.sucursal?.slug };
  if (e.tipo === "envio") {
    return { tipo: "envio", direccionId: e.direccion?.id, provincia: e.provincia ?? undefined };
  }
  return { tipo: "ninguna" };
}

/**
 * El checkout exige estar logueado, pero NO tener cuenta corriente vinculada:
 * quien no vinculó compra a lista general (decisión de producto). Se corta acá,
 * en el servidor, para que la página nunca renderice sin identidad.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string | string[] }>;
}) {
  const { pedido } = await searchParams;
  // Reintento del pago de un pedido existente (`/checkout?pedido=<id>`): el servidor lo valida.
  const pedidoReintento = typeof pedido === "string" && pedido ? pedido : null;
  // Las reglas y los medios de pago no dependen de la identidad: arrancan antes de esperarla para
  // que se resuelvan en paralelo con esa consulta en vez de después (misma
  // semántica, una espera menos en la cascada). `identidadActual` decide el
  // redirect, así que a ella sí hay que esperarla antes de renderizar.
  const reglasPromise = reglasVentaCacheadas();
  const mediosPromise = mediosOfrecibles();

  const { clerkUserId, cliente, nombre, email } = await identidadActual();
  if (!clerkUserId && !cliente) {
    redirect(rutaIngreso("/checkout"));
  }

  // Sin datos fiscales no se puede facturar la compra. Se resuelve acá y se
  // avisa arriba de todo, en vez de dejar que llene el formulario entero y
  // recién rebote contra el 409 al apretar "Confirmar". Misma lectura que
  // `POST /api/pedidos` (`datosDelContacto`): vinculado ⇒ espejo de Alegra.
  //
  // Los medios de pago son los del CRM, sin Mercado Pago si faltan las credenciales en el Shop. Las
  // cuotas sin interés viajan en cada medio (`condicionesCuotas`); el servidor sólo las ofrece con el
  // flag `cuotas-cobro` prendido.
  const [reglas, mediosOfrecidos] = await Promise.all([reglasPromise, mediosPromise]);
  // Cuenta corriente: al navegador sólo viaja el medio de su audiencia; al resto, nunca ese medio
  // (ni su nombre ni sus instrucciones). El servidor vuelve a validar en `POST /api/pedidos`.
  const esCuentaCorriente = esCompradorCuentaCorriente(cliente);
  const mediosPago = mediosVisiblesPara(mediosOfrecidos, esCuentaCorriente);
  // Con el flag `sucursales`: locales de retiro y zona vigente. null = como siempre.
  const sucursales = await opcionesCheckoutDelVisitante().catch(
    (err: unknown) => {
      console.error("[checkout] no se pudieron leer las sucursales:", err);
      return null;
    },
  );
  // Sin la elección el checkout arranca como siempre: una falla al leerla no frena la compra.
  const eleccion = await ubicacionDelVisitante()
    .then((u) => eleccionParaCheckout(u.eleccion))
    .catch((err: unknown) => {
      console.error("[checkout] no se pudo leer la ubicación elegida:", err);
      return null;
    });
  const [dc, direcciones] = await Promise.all([
    datosDelContacto({ clerkUserId, cliente }),
    // Sólo con Clerk: la cookie del CRM sin Clerk no guarda direcciones.
    clerkUserId ? direccionesParaCheckout(clerkUserId) : [],
  ]);

  const perfil = dc.perfil;
  // Su documento ya es de un cliente de Alegra y no vinculó: se le ofrece
  // vincular siempre, tenga o no cuenta corriente (el vínculo ata la compra al
  // contacto y trae sus datos de Alegra).
  const sugerirVincular = !cliente && !!perfil?.coincideConAlegra;
  // Para el formulario del no vinculado: sólo las columnas que muestra.
  const perfilUI = perfil
    ? {
        pais: perfil.pais,
        tipoDoc: perfil.tipoDoc,
        nroDoc: perfil.nroDoc,
        razonSocial: perfil.razonSocial,
        condicionIva: perfil.condicionIva,
        domicilioCalle: perfil.domicilioCalle,
        domicilioCiudad: perfil.domicilioCiudad,
        domicilioProvincia: perfil.domicilioProvincia,
        domicilioCp: perfil.domicilioCp,
        telefono: perfil.telefono,
      }
    : null;

  return (
    <>
      {/* Sin footer en mobile: ver `[data-sin-footer-mobile]` en globals.css. */}
      <span data-sin-footer-mobile hidden />
      <CheckoutClient
        nombreSugerido={
          dc.datos.razonSocial ?? cliente?.razonsocial ?? nombre ?? ""
        }
        // Vinculado: el de Alegra (no se vuelve a pedir); si no hay, el del perfil.
        telefonoSugerido={
          telefonoDelCheckout({
            telefonoAlegra: dc.telefonoAlegra,
            telefonoPerfil: perfil?.telefono,
          }).inicial
        }
        emailCliente={cliente?.email ?? email}
        facturacion={paraElCliente(dc)}
        perfilFacturacion={perfilUI}
        admiteEnvio={admiteEnvio(dc.datos.pais)}
        configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
        direccionesGuardadas={direcciones}
        sugerirVincular={sugerirVincular}
        sucursales={sucursales}
        mediosPago={mediosPago}
        esCuentaCorriente={esCuentaCorriente}
        eleccionInicial={eleccion}
        pedidoReintento={pedidoReintento}
      />
    </>
  );
}

import { redirect } from "next/navigation";
import { rutaIngreso } from "@/lib/ingreso";
import { CheckoutClient } from "@/components/CheckoutClient";
import { identidadActual } from "@/lib/auth";
import { admiteEnvio } from "@/lib/facturacion";
import { datosDelContacto, paraElCliente } from "@/lib/datos-del-contacto";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { envioHabilitado } from "@/lib/envio-flag";
import { listarDirecciones } from "@/lib/direcciones-envio-db";
import type { DireccionEnvio } from "@/lib/direcciones-envio";

/**
 * Direcciones guardadas para precargar el envío. Si la consulta falla (por
 * ejemplo, `0003` todavía sin aplicar) el checkout sigue como antes, sin
 * direcciones: comprar importa más que la precarga.
 */
async function direccionesParaCheckout(clerkUserId: string): Promise<DireccionEnvio[]> {
  try {
    return await listarDirecciones(clerkUserId);
  } catch (err) {
    console.error("[checkout] no se pudieron leer las direcciones guardadas:", err);
    return [];
  }
}

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
  // recién rebote contra el 409 al apretar "Confirmar". Misma lectura que
  // `POST /api/pedidos` (`datosDelContacto`): vinculado ⇒ espejo de Alegra.
  // En paralelo con la oferta de cuotas (null = sin cuotas: flag off, sin datos o error).
  //
  // El flag de pagos se lee acá, en el server, y al checkout le llega como
  // booleano. Apagado, la oferta de cuotas ni se consulta: sin "Forma de pago"
  // no hay dónde mostrarla.
  const [pagos, envio] = await Promise.all([pagosHabilitados(), envioHabilitado()]);
  const [dc, oferta, direcciones] = await Promise.all([
    datosDelContacto({ clerkUserId, cliente }),
    pagos ? getOfertaCuotas() : null,
    // Sólo con Clerk: la cookie del CRM sin Clerk no guarda direcciones.
    clerkUserId ? direccionesParaCheckout(clerkUserId) : [],
  ]);

  const perfil = dc.perfil;
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
      <CheckoutClient
        nombreSugerido={
          dc.datos.razonSocial ?? cliente?.razonsocial ?? nombre ?? ""
        }
        telefonoSugerido={perfil?.telefono ?? ""}
        emailCliente={cliente?.email ?? email}
        facturacion={paraElCliente(dc)}
        perfilFacturacion={perfilUI}
        admiteEnvio={admiteEnvio(dc.datos.pais)}
        oferta={oferta}
        pagosHabilitados={pagos}
        envioHabilitado={envio}
        direccionesGuardadas={direcciones}
        // Su documento ya es de un cliente de Alegra y no vinculó: se le
        // recomienda vincular ANTES de pagar a precio de lista.
        sugerirVincular={Boolean(perfil?.coincideConAlegra) && !cliente}
      />
    </>
  );
}

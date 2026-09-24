"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@myd-org/ui";
import { FacturacionForm, type PerfilFacturacionUI } from "@/components/FacturacionForm";
import { estadoMisDatos, tienePerfilFacturacion } from "@/lib/mis-datos";
import { AvisoVincular } from "./AvisoVincular";
import { CuentaClienteCard } from "./CuentaClienteCard";
import { DatosPersonalesCard } from "./DatosPersonalesCard";
import { PreguntaCliente, SugerirVincular } from "./PreguntaCliente";

/**
 * "Mis datos" para quien tiene sesión de Clerk: datos personales (nombre y
 * correo, los administra Clerk), facturación (el formulario de siempre, bloqueado si la cuenta está
 * vinculada: Alegra es la fuente de verdad) y la cuenta de cliente.
 *
 * Qué se muestra lo decide `estadoMisDatos`. Sin vincular y sin datos de
 * facturación, primero se pregunta si ya es cliente: el formulario queda
 * oculto hasta que responda "No, es mi primera compra".
 *
 * Sin enlace al portal del CRM: la cuenta corriente del cliente de la tienda
 * vive en Mi cuenta (change `portal-al-shop`).
 */
export function DatosCuenta({
  nombre,
  email,
  perfilFacturacion,
  razonSocialVinculada,
  cuit,
}: {
  nombre?: string;
  email?: string;
  perfilFacturacion: PerfilFacturacionUI | null;
  /** undefined = todavía no vinculó ninguna cuenta. */
  razonSocialVinculada?: string;
  cuit?: string;
}) {
  const router = useRouter();
  const vinculado = Boolean(razonSocialVinculada);
  const estado = estadoMisDatos({
    vinculado,
    tienePerfil: tienePerfilFacturacion(perfilFacturacion),
    coincideConAlegra: Boolean(perfilFacturacion?.coincideConAlegra),
  });

  // Respondió "No, es mi primera compra": se muestra el formulario y se lleva
  // el foco (y la vista) a la card de facturación.
  const [primeraCompra, setPrimeraCompra] = useState(false);
  const facturacion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!primeraCompra) return;
    const card = facturacion.current;
    if (!card) return;
    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: reducir ? "auto" : "smooth", block: "start" });
  }, [primeraCompra]);

  const preguntando = estado === "preguntar" && !primeraCompra;

  return (
    <div className="flex flex-col gap-4">
      {estado === "sugerir_vincular" && <AvisoVincular />}
      {preguntando && <PreguntaCliente onPrimeraCompra={() => setPrimeraCompra(true)} />}

      <DatosPersonalesCard nombre={nombre} email={email} />

      {!preguntando && (
        <Card
          ref={facturacion}
          // Destino del foco al responder "No": enfocable sólo por código.
          tabIndex={-1}
          title="Datos de facturación"
          description={
            vinculado
              ? "Estos datos provienen de su cuenta en nuestro sistema. Si algo no es correcto, escríbanos y lo corregimos."
              : "Los necesitamos para emitirle la factura de sus compras."
          }
        >
          <FacturacionForm
            perfil={perfilFacturacion}
            // Vinculado: la razón social la manda el sistema, no se sugiere nada.
            nombreSugerido={vinculado ? undefined : nombre}
            bloqueado={vinculado}
            onGuardado={() => router.refresh()}
          />
        </Card>
      )}

      {estado === "vinculado" && razonSocialVinculada && (
        <CuentaClienteCard razonSocialVinculada={razonSocialVinculada} cuit={cuit} />
      )}
      {estado === "formulario" && <SugerirVincular />}
    </div>
  );
}

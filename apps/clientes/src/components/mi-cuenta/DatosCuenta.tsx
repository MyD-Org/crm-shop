"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@myd-org/ui";
import { FacturacionForm, type PerfilFacturacionUI } from "@/components/FacturacionForm";
import { CompletarFacturacionDialog } from "@/components/checkout/CompletarFacturacionDialog";
import type { DatosDelContactoPublico } from "@/lib/datos-del-contacto";
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
  facturacionVinculada,
}: {
  nombre?: string;
  email?: string;
  perfilFacturacion: PerfilFacturacionUI | null;
  /** undefined = todavía no vinculó ninguna cuenta. */
  razonSocialVinculada?: string;
  cuit?: string;
  /**
   * Vinculado: los datos de facturación de la lectura única (espejo de Alegra,
   * o mezclado con su perfil del mismo documento). Se muestran en lugar del
   * perfil, que un vinculado puede no tener (#499).
   */
  facturacionVinculada?: DatosDelContactoPublico;
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
  const [completando, setCompletando] = useState(false);

  // Vinculado: lo que se muestra sale del espejo; el teléfono también (y si
  // Alegra no tiene ninguno, el del perfil, editable).
  const fv = vinculado ? facturacionVinculada : undefined;
  const perfilMostrado: PerfilFacturacionUI | null = fv
    ? {
        pais: fv.datos.pais,
        tipoDoc: fv.datos.tipoDoc ?? null,
        nroDoc: fv.datos.nroDoc ?? null,
        razonSocial: fv.datos.razonSocial ?? null,
        condicionIva: fv.datos.condicionIva ?? fv.datos.condicionIvaAlegra ?? null,
        domicilioCalle: fv.datos.domicilioCalle ?? null,
        domicilioCiudad: fv.datos.domicilioCiudad ?? null,
        domicilioProvincia: fv.datos.domicilioProvincia ?? null,
        domicilioCp: fv.datos.domicilioCp ?? null,
        telefono: fv.telefonoAlegra ?? perfilFacturacion?.telefono ?? null,
      }
    : perfilFacturacion;
  const deSuCuenta = fv ? ["espejo", "mixto", "vivo"].includes(fv.fuente) : false;
  const puedeCompletar = Boolean(fv && fv.faltantes.length > 0 && fv.fuente !== "no_disponible");

  function descripcionFacturacion(): string {
    if (!vinculado) return "Los necesitamos para emitirle la factura de sus compras.";
    if (fv?.fuente === "no_disponible") {
      return "No pudimos obtener sus datos de facturación. Inténtelo de nuevo en unos minutos.";
    }
    if (deSuCuenta || !fv) {
      return "Estos datos provienen de su cuenta en nuestro sistema. Si algo no es correcto, escríbanos y lo corregimos.";
    }
    return "Los necesitamos para emitirle la factura de sus compras.";
  }

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
          description={descripcionFacturacion()}
        >
          {puedeCompletar && fv && (
            <div className="mb-4 flex flex-col items-start gap-2">
              <p className="text-sm text-muted">Faltan datos para emitirle la factura.</p>
              <Button size="sm" aria-haspopup="dialog" onClick={() => setCompletando(true)}>
                Completar datos
              </Button>
              <CompletarFacturacionDialog
                abierto={completando}
                onOpenChange={setCompletando}
                facturacion={fv}
                perfil={null}
                descripcion="Los necesitamos para emitirle la factura de sus compras. Se cargan una sola vez."
              />
            </div>
          )}
          <FacturacionForm
            // Remonta con los datos nuevos tras completar (router.refresh).
            key={vinculado ? JSON.stringify(perfilMostrado) : "perfil"}
            perfil={perfilMostrado}
            // Vinculado: la razón social la manda el sistema, no se sugiere nada.
            nombreSugerido={vinculado ? undefined : nombre}
            bloqueado={vinculado}
            telefonosCuenta={fv?.telefonos ?? null}
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

"use client";

import { useRouter } from "next/navigation";
import { Card } from "@myd-org/ui";
import { FacturacionForm, type PerfilFacturacionUI } from "@/components/FacturacionForm";
import { AvisoVincular } from "./AvisoVincular";
import { CuentaClienteCard } from "./CuentaClienteCard";
import { DatosPersonalesCard } from "./DatosPersonalesCard";

/**
 * "Mis datos" para quien tiene sesión de Clerk: datos personales (nombre y
 * correo, los administra Clerk), facturación (el formulario de siempre, bloqueado si la cuenta está
 * vinculada: Alegra es la fuente de verdad) y la cuenta de cliente.
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
  /** undefined = todavía no vinculó ninguna cuenta (compra a lista general). */
  razonSocialVinculada?: string;
  cuit?: string;
}) {
  const router = useRouter();
  const vinculado = Boolean(razonSocialVinculada);
  // Su documento ya es de un cliente de Alegra: el aviso va arriba de todo en
  // vez de la card genérica del final.
  const sugerirVincular = !vinculado && Boolean(perfilFacturacion?.coincideConAlegra);

  return (
    <div className="flex flex-col gap-4">
      {sugerirVincular && <AvisoVincular />}

      <DatosPersonalesCard nombre={nombre} email={email} />

      <Card
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

      {!sugerirVincular && (
        <CuentaClienteCard razonSocialVinculada={razonSocialVinculada} cuit={cuit} />
      )}
    </div>
  );
}

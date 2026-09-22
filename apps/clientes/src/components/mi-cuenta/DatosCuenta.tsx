"use client";

import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { Button, Card, type RenderLink } from "@myd-org/ui";
import { FacturacionForm, type PerfilFacturacionUI } from "@/components/FacturacionForm";
import { CuentaClienteCard } from "./CuentaClienteCard";

/** Portal de cuenta corriente del CRM (misma variable que usaba Mis compras). */
const PORTAL_CUENTA_CORRIENTE = `${process.env.NEXT_PUBLIC_CRM_URL ?? "https://crm.cliente.example"}/portal/dashboard`;

/** El portal es otra aplicación: se abre en una pestaña nueva. */
const enlaceExterno: RenderLink = (props) => <a {...props} target="_blank" rel="noopener noreferrer" />;

/**
 * "Mis datos" para quien tiene sesión de Clerk: acceso (lo administra Clerk),
 * facturación (el formulario de siempre, bloqueado si la cuenta está
 * vinculada: Alegra es la fuente de verdad) y la cuenta de cliente.
 */
export function DatosCuenta({
  email,
  perfilFacturacion,
  razonSocialVinculada,
  cuit,
  esCuentaCorriente,
}: {
  email?: string;
  perfilFacturacion: PerfilFacturacionUI | null;
  /** undefined = todavía no vinculó ninguna cuenta (compra a lista general). */
  razonSocialVinculada?: string;
  cuit?: string;
  esCuentaCorriente: boolean;
}) {
  const router = useRouter();
  const { openUserProfile } = useClerk();
  const vinculado = Boolean(razonSocialVinculada);

  return (
    <div className="flex flex-col gap-4">
      {/* Botón en vez de explicar dónde queda: `openUserProfile()` abre el
          panel de Clerk en un modal, acá mismo. */}
      <Card
        title="Datos de acceso"
        action={
          <Button variant="outline" size="sm" onClick={() => openUserProfile()}>
            Editar mi cuenta
          </Button>
        }
      >
        {email && <p className="text-sm text-muted">Accede con {email}.</p>}
      </Card>

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
          bloqueado={vinculado}
          onGuardado={() => router.refresh()}
        />
      </Card>

      <CuentaClienteCard
        razonSocialVinculada={razonSocialVinculada}
        cuit={cuit}
        coincideConAlegra={Boolean(perfilFacturacion?.coincideConAlegra)}
      />

      {esCuentaCorriente && (
        <div>
          <Button variant="outline" href={PORTAL_CUENTA_CORRIENTE} renderLink={enlaceExterno}>
            Portal cuenta corriente
          </Button>
        </div>
      )}
    </div>
  );
}

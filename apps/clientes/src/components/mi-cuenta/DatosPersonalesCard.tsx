"use client";

import { useClerk } from "@clerk/nextjs";
import { Button, Card } from "@myd-org/ui";

/**
 * Datos personales de la cuenta de Clerk (nombre y correo), en sólo lectura.
 * Se editan en el panel de Clerk (`openUserProfile`, un modal acá mismo), que
 * es el dueño de esos datos.
 */
export function DatosPersonalesCard({ nombre, email }: { nombre?: string; email?: string }) {
  const { openUserProfile } = useClerk();
  return (
    <Card
      title="Datos personales"
      action={
        <Button variant="outline" size="sm" onClick={() => openUserProfile()}>
          Editar mi cuenta
        </Button>
      }
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Nombre</dt>
          <dd className="font-medium text-text">{nombre || "Sin cargar"}</dd>
        </div>
        <div>
          <dt className="text-muted">Correo electrónico</dt>
          <dd className="font-medium text-text">{email || "Sin cargar"}</dd>
        </div>
      </dl>
    </Card>
  );
}

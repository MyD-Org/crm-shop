"use client";

import { Button, Card } from "@myd-org/ui";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { BotonEnlace } from "./BotonEnlace";

/**
 * Pregunta inicial de Mis datos (estado `preguntar`): sin vincular y sin datos
 * de facturación. "Sí" lleva a vincular; "No" muestra el formulario de
 * facturación (lo decide quien llama con `onPrimeraCompra`).
 */
export function PreguntaCliente({ onPrimeraCompra }: { onPrimeraCompra: () => void }) {
  return (
    <Card title="¿Ya es cliente de Central LED?">
      <p className="text-sm text-muted">
        Si ya compró en nuestro local, vincule su cuenta para ver sus facturas y sus compras.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <BotonEnlace href={RUTAS_MI_CUENTA.vincular}>Sí, vincular mi cuenta</BotonEnlace>
        <Button variant="outline" onClick={onPrimeraCompra}>
          No, es mi primera compra
        </Button>
      </div>
    </Card>
  );
}

/**
 * Enlace discreto para vincular (estado `formulario`): ya cargó sus datos de
 * facturación sin vincular. Reemplaza a la card "¿Ya es cliente del local?".
 */
export function SugerirVincular() {
  return (
    <p className="text-sm text-muted">
      ¿Ya es cliente de Central LED?{" "}
      <BotonEnlace variant="link" size="inline" href={RUTAS_MI_CUENTA.vincular}>
        Vincule su cuenta
      </BotonEnlace>
    </p>
  );
}

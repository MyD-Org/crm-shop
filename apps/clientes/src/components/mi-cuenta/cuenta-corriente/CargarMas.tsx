"use client";

import { Alert, Button } from "@myd-org/ui";

/**
 * "Mostrando N de T" y "Cargar más", que agrega la página siguiente debajo.
 * Sin más páginas, el botón no está.
 */
export function CargarMas({
  cantidad,
  total,
  cargando,
  error,
  onCargarMas,
}: {
  cantidad: number;
  total: number;
  cargando: boolean;
  error: string | null;
  onCargarMas?: () => void;
}) {
  if (total === 0 && !error) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-sm text-muted" aria-live="polite">
        Mostrando {cantidad} de {total}
      </p>
      {onCargarMas && cantidad < total && (
        <Button variant="outline" onClick={onCargarMas} loading={cargando}>
          Cargar más
        </Button>
      )}
    </div>
  );
}

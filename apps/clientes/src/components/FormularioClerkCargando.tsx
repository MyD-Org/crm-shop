/**
 * Lugar del formulario de Clerk (/ingresar, /registro) mientras su script
 * carga. Sin esto la página quedaba sin alto y el footer subía hasta pegarse al
 * header. Medidas aproximadas a la tarjeta de Clerk (400 px de ancho).
 */
export function FormularioClerkCargando() {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className="flex min-h-[460px] w-full max-w-[400px] flex-col gap-4 rounded-xl border border-border bg-surface p-8"
    >
      <div className="h-11 animate-pulse rounded-md bg-muted/15" />
      <div className="mx-auto h-3 w-10 animate-pulse rounded bg-muted/15" />
      <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted/15" />
      <div className="h-11 animate-pulse rounded-md bg-muted/15" />
      <div className="mt-2 h-11 animate-pulse rounded-md bg-muted/25" />
      <div className="mx-auto mt-auto h-3 w-48 animate-pulse rounded bg-muted/15" />
    </div>
  );
}

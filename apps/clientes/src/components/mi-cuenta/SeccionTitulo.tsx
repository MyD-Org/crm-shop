import { BotonEnlace } from "./BotonEnlace";
import { IconoFlecha } from "./iconos";

/**
 * Título de una sección de Mi cuenta (`<h2>`: el `<h1>` es el saludo del
 * shell) con un "Ver todos" opcional.
 */
export function SeccionTitulo({
  id,
  titulo,
  href,
  verTodos = "Ver todos",
}: {
  id?: string;
  titulo: string;
  href?: string;
  verTodos?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={id} className="font-display text-xl font-medium tracking-tight text-text">
        {titulo}
      </h2>
      {href && (
        <BotonEnlace variant="link" href={href}>
          {verTodos} <IconoFlecha />
        </BotonEnlace>
      )}
    </div>
  );
}

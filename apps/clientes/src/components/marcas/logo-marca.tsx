import { cn } from "@myd-org/ui";
import { ImagenMarca } from "./ImagenMarca";

/**
 * Cómo se funde el logo con el fondo de la página: sobre fondo oscuro, `screen` hace desaparecer
 * el negro del archivo; sobre fondo claro, `multiply` hace desaparecer el blanco. Un logo con
 * fondo transparente se ve igual que siempre.
 */
export function claseFusionLogo(fondoOscuro: boolean): string {
  return fondoOscuro ? "mix-blend-screen" : "mix-blend-multiply";
}

/** El logo de una marca, tal cual (sin caja): el alto lo pone `className`, el ancho se ajusta solo. */
export function LogoMarca({
  src,
  nombre,
  fondoOscuro,
  className,
}: {
  src: string;
  nombre: string;
  fondoOscuro: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative block shrink-0", className)}>
      <ImagenMarca
        src={src}
        alt={`Logo de ${nombre}`}
        sizes="320px"
        fit="logo"
        className={cn("h-full w-auto max-w-none object-contain", claseFusionLogo(fondoOscuro))}
      />
    </span>
  );
}

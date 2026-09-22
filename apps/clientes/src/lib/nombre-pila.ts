/**
 * Nombre de pila para el saludo de Mi cuenta ("Hola, {nombre}"). Módulo puro.
 *
 * Orden: el `firstName` de Clerk; si falta, la primera palabra del nombre
 * completo; si tampoco hay, la razón social del cliente (identidades que sólo
 * vienen de la cookie del CRM, o empresas). `||` y no `??`: un texto en blanco
 * no cuenta como nombre. null = quien renderiza saluda con "cliente".
 */
export function nombrePila({
  firstName,
  fullName,
  razonSocial,
}: {
  firstName?: string | null;
  fullName?: string | null;
  razonSocial?: string | null;
}): string | null {
  return (
    firstName?.trim() ||
    fullName?.trim().split(/\s+/)[0] ||
    razonSocial?.trim() ||
    null
  );
}

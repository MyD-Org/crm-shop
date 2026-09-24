/**
 * Cierre de sesión completo de la tienda.
 *
 * Además de Clerk, limpia lo que queda en el navegador y sobreviviría al
 * cierre: el carrito (localStorage) y la cookie heredada del portal del CRM,
 * que la tienda sigue aceptando como identidad. Si la cookie no se pudo borrar
 * (red caída), se cierra la sesión igual: no se deja al usuario adentro.
 */
export async function cerrarSesion({
  vaciarCarrito,
  signOut,
  fetchImpl = fetch,
}: {
  vaciarCarrito: () => void;
  signOut: () => Promise<unknown>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  vaciarCarrito();
  try {
    await fetchImpl("/api/sesion/cerrar", { method: "POST" });
  } catch {
    // Ver arriba: no bloquea el cierre.
  }
  await signOut();
}

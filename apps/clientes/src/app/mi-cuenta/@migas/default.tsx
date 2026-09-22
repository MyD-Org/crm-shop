/**
 * Fallback del slot de migas. Con `[...ruta]` toda URL de Mi cuenta tiene su
 * página en el slot, así que en la práctica no se usa; sin este archivo una
 * navegación dura a una ruta sin página en el slot daría error.
 */
export default function MigasDefault() {
  return null;
}

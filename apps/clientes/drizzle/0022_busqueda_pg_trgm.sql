-- pg_trgm para la búsqueda tolerante a errores de tipeo del catálogo ("lampra" → "lámpara").
--
-- La usa `coincideTexto(q, tolerante)` en src/lib/catalog.ts, llamando a
-- `public.word_similarity` CALIFICADA: igual que `unaccent` (0000), vive en `public` y no se
-- depende del `search_path` de la conexión.
--
-- Sin índice a propósito: la búsqueda corre sobre las vistas del CRM (unos miles de filas por
-- tenant) y sólo como segundo intento, cuando la búsqueda exacta no trajo nada. Si el código
-- corre antes que esta migración, ese segundo intento falla y se trata como "sin resultados".
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

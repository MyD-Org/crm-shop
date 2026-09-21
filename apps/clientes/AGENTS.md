# apps/clientes — Shop

Las reglas comunes (Next.js, ecosistema, repo público, textos de UI) están en el `AGENTS.md` y `CLAUDE.md` de la raíz.

- Correr todo parado en `apps/clientes`.
- Esta carpeta no tiene `.npmrc`: para instalar `@myd-org/ui` en local hace falta la configuración del registro `@myd-org` en el `~/.npmrc` del usuario. En CI lo resuelve `actions/setup-node`.
- Integra con `apps/admin` por HTTP (cuotas, overlay de catálogo, revalidación). Docs en `docs/`.

# apps/admin — CRM

Las reglas comunes (Next.js, ecosistema, repo público, textos de UI) están en el `AGENTS.md` y `CLAUDE.md` de la raíz.

- Correr todo parado en `apps/admin`. Los tests de integración usan rutas relativas al cwd (`./drizzle`) y una base local `crm_test`; la guarda `assertLocalTestDb` impide apuntar a una base real.
- Las migraciones de producción NO corren solas en el deploy: se aplican a mano antes de mergear código que dependa de ellas, parado en `apps/admin` **de la rama que trae la migración** (no `main`) y pasando la conexión de prod explícita: `DATABASE_URL="<conexión directa de prod>" npm run db:migrate`. Sin eso, `npm run db:migrate` usa `.env.local`, que apunta a la base local. El script muestra a qué base va y pide escribir el host si no es local (sin terminal: `MIGRATE_CONFIRM=<host>`). Verificar después con un `SELECT` a la tabla nueva.
- Migración escrita a mano ⇒ regenerar el snapshot: `npx tsx scripts/drizzle-snapshot.ts` (no toca ninguna base). Si `drizzle/meta/` queda atrás de `schema.ts`, `drizzle-kit generate` abre un prompt de rename y falla sin TTY; lo vigila `src/db/snapshot-al-dia.test.ts`.
- Integraciones de esta app:
  - **Chat de soporte (ai-widget + ai-api)**: el portal embebe el widget; las tools del agente consultan `/api/agent/*` con un `crm_token` (HMAC). Contrato: `platform/contracts/crm-ai-api.md`. Decisión de auth: `platform/decisions/0001`.
  - **Design system (`MyD-Org/ui`)**: se consume desde GitHub Packages (`.npmrc` de esta carpeta, variable `GITHUB_TOKEN`).
  - **Shop (`apps/clientes`)**: consume datos de cuenta y el overlay de catálogo de esta app por HTTP.
- Si cambiás un endpoint `/api/agent/*` o el formato del token, actualizá el doc en `platform` en el mismo cambio.
- Funcionalidades documentadas en `docs/FUNCIONALIDADES.md`; deploy en `docs/DEPLOY.md`.

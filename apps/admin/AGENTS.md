# apps/admin — CRM

Las reglas comunes (Next.js, ecosistema, repo público, textos de UI) están en el `AGENTS.md` y `CLAUDE.md` de la raíz.

- Correr todo parado en `apps/admin`. Los tests de integración usan rutas relativas al cwd (`./drizzle`) y una base local `crm_test`; la guarda `assertLocalTestDb` impide apuntar a una base real.
- Las migraciones de producción NO corren solas en el deploy: se aplican a mano (`npm run db:migrate` parado en `apps/admin`) antes de mergear código que dependa de ellas.
- Integraciones de esta app:
  - **Chat de soporte (ai-widget + ai-api)**: el portal embebe el widget; las tools del agente consultan `/api/agent/*` con un `crm_token` (HMAC). Contrato: `platform/contracts/crm-ai-api.md`. Decisión de auth: `platform/decisions/0001`.
  - **Design system (`MyD-Org/ui`)**: se consume desde GitHub Packages (`.npmrc` de esta carpeta, variable `GITHUB_TOKEN`).
  - **Shop (`apps/clientes`)**: consume datos de cuenta y el overlay de catálogo de esta app por HTTP.
- Si cambiás un endpoint `/api/agent/*` o el formato del token, actualizá el doc en `platform` en el mismo cambio.
- Funcionalidades documentadas en `docs/FUNCIONALIDADES.md`; deploy en `docs/DEPLOY.md`.

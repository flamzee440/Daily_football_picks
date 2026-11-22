# Deploy and configure Daily Football Picks

## 1. Existing Netlify project
The site is connected to GitHub repository `flamzee440/Daily_football_picks`, branch `main`.

Build command: `npm run build`
Publish directory: `dist`

## 2. Function environment variables
Keep these configured with Functions scope (or All scopes):
- `ADMIN_KEY`: secret protecting the admin dashboard and workflow endpoints.
- `SESSION_SECRET`: separate secret used to sign member login sessions.

The Kilo free gateway supports anonymous access for eligible free models, so this initial test does not require a Kilo API key. Never put credentials in source code.

## 3. AI workflow — initial free-model test
The workflow uses `kilo-auto/free` through Kilo's OpenAI-compatible Chat Completions API:
1. One research-stage request asks the model for candidates.
2. A separate decision-stage request independently scores returned candidates.
3. Application code filters the scores and assembles the final slip locally.

Important limitations:
- The free chat endpoint does not itself provide a web-search tool. This first test is a model-connection and reasoning test, NOT verified live football research.
- The model is explicitly instructed not to invent current facts or source URLs and to return no candidates when current information cannot be verified.
- Free model routing and availability can change. Anonymous access is rate-limited by IP, and upstream providers may impose additional limits.
- Free providers may log prompts and outputs; do not submit personal or confidential information.

## 4. Deploy and verify
Trigger a production deploy from `main`. Then check:
- `/api/health` returns `ok: true`.
- Member signup and login work.
- Admin access, prompt loading and saving work.
- Run the workflow once and inspect the returned model and any limitations.

The database migration in `netlify/database/migrations` creates the member, prompt and daily-picks tables when Netlify Database is available for the account.

## Important limitations
- Member accounts use email/password sessions; email verification and password reset are not yet included.
- The scheduled workflow requires a successful end-to-end test after deployment.
- This is an informational predictions site, not a guarantee of outcomes or a betting/payment service.

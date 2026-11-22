# Deploy and configure Daily Football Picks

## 1. Connect the existing Netlify project to GitHub
In Netlify, open the existing project **daily-football-picks**:
https://app.netlify.com/projects/daily-football-picks

Choose **Project configuration → Build & deploy → Continuous deployment → Link repository**, select GitHub, then choose:
`flamzee440/Daily_football_picks`
Deploy branch: `main`.

Build command: `npm run build`
Publish directory: `dist`

## 2. Add function environment variables
In **Project configuration → Environment variables**, add these three variables with scope **Functions** (or All scopes):

- `GEMINI_API_KEY`: your Google AI Studio Gemini API key. Keep it secret; do not put it in source code or the public website.
- `ADMIN_KEY`: create a long, random secret. This protects the admin dashboard and workflow endpoints.
- `SESSION_SECRET`: create a different long, random secret used to sign member login sessions.

Do not reuse your Gemini key as either of the other secrets.

## 3. Deploy and verify
Trigger a production deploy from `main`. The database migration in `netlify/database/migrations` creates the member, prompt and daily-picks tables when Netlify Database is available for the account.

After deploy, check:
- `/api/health` returns an `ok: true` response.
- Create a free member account and sign in.
- Open **Admin**, enter the `ADMIN_KEY`, load the three prompts, then save them.
- Run the workflow once. It makes three Gemini 2.5 Flash calls with Google Search grounding and publishes the final JSON slip.
- The scheduled workflow runs at 11:00 UTC daily (6:00 AM New York during EST; 7:00 AM during EDT).

## Important limitations in this first release
- Member accounts use email/password sessions; email verification and password reset are not yet included.
- The daily job is scheduled, but the first published deploy and a successful end-to-end Gemini test are required before it can run.
- This is an informational predictions site, not a guarantee of outcomes or a betting/payment service.

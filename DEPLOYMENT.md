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

- `GROQ_API_KEY`: your free Groq API key from https://console.groq.com/keys. Keep it secret; do not put it in source code or the public website. Stay on Groq's Free tier; do not add a payment method or upgrade.
- `ADMIN_KEY`: create a long, random secret. This protects the admin dashboard and workflow endpoints.
- `SESSION_SECRET`: create a different long, random secret used to sign member login sessions.

Do not reuse your Groq key as either of the other secrets. The app uses Groq's OpenAI-compatible Responses API and the `openai/gpt-oss-120b` model. The research request uses Groq's built-in browser search; the decision request independently scores the candidate list.

## 3. Deploy and verify
Trigger a production deploy from `main`. The database migration in `netlify/database/migrations` creates the member, prompt and daily-picks tables when Netlify Database is available for the account.

After deploy, check:
- `/api/health` returns an `ok: true` response.
- Create a free member account and sign in.
- Open **Admin**, enter the `ADMIN_KEY`, load the master prompt, then save it.
- Run the workflow once. The normal path makes two OpenAI Responses API requests: one GPT-6.2 Astra request with the built-in web search tool to research and return candidates, followed by one GPT-6.2 Astra request to score all candidates together. The application filters and assembles the final slip locally, with no third model request.
- The scheduled workflow runs at 11:00 UTC daily (6:00 AM New York during EST; 7:00 AM during EDT).

## Workflow request limits
- The normal workflow makes two Groq model requests: one browser-search research request and one independent decision request.
- Browser search is built into Groq's Responses API for the GPT-OSS models; it does not require a separate search API key.
- The application assembles the final slip and calculates combined decimal odds in code. It does not use a third model call.
- Groq's Free tier has rate and token limits. If the account reaches a limit, the run may fail until the limit resets. Do not upgrade or add a payment method if you want to keep the app fully free.

## Important limitations in this first release
- Member accounts use email/password sessions; email verification and password reset are not yet included.
- The daily job is scheduled, but the first published deploy and a successful end-to-end Groq test are required before it can run.
- This is an informational predictions site, not a guarantee of outcomes or a betting/payment service.

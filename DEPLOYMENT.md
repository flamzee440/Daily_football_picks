# Deploy and configure Daily Football Picks

## 1. Existing Netlify project
The site is connected to GitHub repository `flamzee440/Daily_football_picks`, branch `main`.

Build command: `npm run build`
Publish directory: `dist`

## 2. Function environment variables
In Netlify Project configuration → Environment variables, configure these with Functions scope (or All scopes):

- `OPENAI_API_KEY`: your secret OpenAI API key. Keep it private; never put it in source code or the public website.
- `ADMIN_KEY`: a long, random secret protecting the admin dashboard and workflow endpoints.
- `SESSION_SECRET`: a different long, random secret used to sign member login sessions.

Do not reuse the OpenAI key as either of the other secrets.

## 3. AI workflow
The workflow uses `gpt-5.4-mini` through the OpenAI Responses API:
1. One research request uses the hosted `web_search` tool to investigate current fixtures, team news, referees, statistics and odds, returning up to 40 candidates.
2. A separate decision request independently scores every candidate.
3. Application code filters the scores and assembles the final slip locally. No third model request is made.

The research and decision requests are separate. A normal run therefore uses two model requests. Web search is an additional billable tool, and model tokens and search calls may incur charges depending on the account's actual billing/credit status. The dashboard's rate limits are request/token ceilings, not a statement that usage is free. Check API billing and usage before enabling scheduled runs.

## 4. Deploy and verify
Trigger a production deploy from `main`. Then check:
- `/api/health` returns `ok: true`.
- Member signup and login work.
- Admin access, prompt loading and saving work.
- Run the workflow once and confirm both OpenAI requests succeed.

The database migration in `netlify/database/migrations` creates the member, prompt and daily-picks tables when Netlify Database is available for the account.

## Important limitations
- Member accounts use email/password sessions; email verification and password reset are not yet included.
- The scheduled workflow requires a successful end-to-end test after deployment.
- This is an informational predictions site, not a guarantee of outcomes or a betting/payment service.

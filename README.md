# Daily Football Picks

A daily football-picks publishing site powered by Gemini research.

## Stack
- Vite frontend
- Netlify Functions backend
- Gemini 2.5 Flash with Google Search grounding
- Netlify Blobs for prompts and published picks

## Setup
1. Connect this repository to the existing Netlify project `daily-football-picks`.
2. Set the Netlify function environment variables `GEMINI_API_KEY` and `ADMIN_KEY`.
3. Deploy the `main` branch.

The public site only displays published picks. Admin endpoints require the secret admin key.

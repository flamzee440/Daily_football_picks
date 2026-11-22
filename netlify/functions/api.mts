import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

const store = () => getStore({ name: "daily-football-picks-data", consistency: "strong" });
const json = (data: unknown, status = 200) => Response.json(data, { status });
const admin = (req: Request) => {
  const expected = Netlify.env.get("ADMIN_KEY");
  return !!expected && req.headers.get("x-admin-key") === expected;
};
const read = async (key: string, fallback: any) => (await store().get(key, { type: "json" })) ?? fallback;
const write = async (key: string, value: unknown) => store().setJSON(key, value);

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/?/, "");
    if (req.method === "GET" && path === "picks") {
      return json({ picks: await read("published-picks", []) });
    }
    if (req.method === "POST" && path === "admin/auth") {
      return admin(req) ? json({ ok: true }) : json({ error: "Invalid administrator key." }, 401);
    }
    if (!path.startsWith("admin/") || !admin(req)) return json({ error: "Administrator access required." }, 401);

    if (req.method === "POST" && path === "admin/fetch-data") {
      const key = Netlify.env.get("API_FOOTBALL_KEY");
      if (!key) return json({ error: "API_FOOTBALL_KEY is not configured in this Netlify project yet." }, 503);
      const now = new Date();
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}`, { headers: { "x-apisports-key": key } });
      if (!response.ok) return json({ error: `Football data provider returned HTTP ${response.status}.` }, 502);
      const payload = await response.json();
      if (payload.errors && Object.keys(payload.errors).length) return json({ error: JSON.stringify(payload.errors) }, 502);
      const fixtures = (payload.response || []).map((item: any) => ({
        fixtureId: item.fixture?.id, league: item.league?.name, country: item.league?.country,
        kickoff: item.fixture?.date, status: item.fixture?.status?.short,
        home: item.teams?.home?.name, away: item.teams?.away?.name,
        venue: item.fixture?.venue?.name, referee: item.fixture?.referee,
        goals: item.goals, score: item.score
      }));
      const dataset = { dateWAT: date, fetchedAt: now.toISOString(), count: fixtures.length, fixtures };
      await write("latest-football-dataset", dataset);
      return json(dataset);
    }
    if (req.method === "GET" && path === "admin/data") return json(await read("latest-football-dataset", { count: 0, fixtures: [] }));
    if (req.method === "POST" && path === "admin/publish") {
      const body = await req.json() as any;
      const selections = body?.selections;
      if (!Array.isArray(selections) || !selections.length || selections.length > 30) return json({ error: "Provide between 1 and 30 selections in a selections array." }, 400);
      const valid = selections.map((p: any) => ({
        id: crypto.randomUUID(), league: String(p.league || "Football"),
        home: String(p.home || "").trim(), away: String(p.away || "").trim(),
        market: String(p.market || "").trim(), selection: String(p.selection || "").trim(),
        odds: Number(p.odds), kickoff: String(p.kickoff || ""),
        publishedAt: new Date().toISOString()
      }));
      if (valid.some((p: any) => !p.home || !p.away || !p.market || !p.selection || !Number.isFinite(p.odds) || p.odds <= 1)) {
        return json({ error: "Every pick needs home, away, market, selection and decimal odds greater than 1." }, 400);
      }
      const previous = await read("published-picks", []);
      await write("published-picks", [...valid, ...previous].slice(0, 100));
      return json({ ok: true, count: valid.length });
    }
    if (req.method === "POST" && path === "admin/chat") {
      const { message } = await req.json() as any;
      if (!message || typeof message !== "string") return json({ error: "Enter a message." }, 400);
      const response = await fetch("https://ai-gateway.kilo.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "kilo-auto/free",
          messages: [{ role: "user", content: message }]
        })
      });
      const result = await response.json() as any;
      if (!response.ok) return json({ error: result?.error?.message || `Kilo provider returned HTTP ${response.status}.` }, 502);
      return json({ reply: result?.choices?.[0]?.message?.content || result?.output_text || "No response text was returned." });
    }
    return json({ error: "API route not found." }, 404);
  } catch (error) {
    console.error("Daily Football Picks API error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
};

export const config: Config = { path: "/api/*" };

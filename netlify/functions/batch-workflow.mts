import type { Config } from "@netlify/functions";

const SITE = "https://daily-football-picks-1cc3.netlify.app";
const wait = (ms:number) => new Promise(resolve => setTimeout(resolve, ms));

export default async (request:Request) => {
  const adminKey = Netlify.env.get("ADMIN_KEY");
  if (!adminKey) throw new Error("ADMIN_KEY is not configured.");
  const cookie = request.headers.get("cookie") || "";
  const headers = { "content-type":"application/json", "x-admin-key":adminKey, ...(cookie ? { cookie } : {}) };
  const call = async (path:string) => {
    const response = await fetch(SITE + "/api/" + path, {
      method: path === "admin/status" ? "GET" : "POST",
      headers,
      body: path === "admin/status" ? undefined : "{}",
      signal: AbortSignal.timeout(55000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || ("Workflow request failed: " + response.status));
    return data;
  };
  await call("admin/run");
  let state = await call("admin/status");
  while (state.status === "running") {
    const delay = Math.max(0, Number(state.nextRunAt || 0) - Date.now());
    if (delay) await wait(delay);
    state = await call("admin/process-next");
    console.log("Batch workflow progress:", state.completedBatches, "/", state.totalBatches, state.stage);
  }
  console.log("Batch workflow finished:", state.status);
};

export const config:Config = { background:true };

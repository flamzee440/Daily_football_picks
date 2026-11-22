import type { Config } from "@netlify/functions";

export default async () => {
  const siteUrl = "https://daily-football-picks.netlify.app";
  const adminKey = Netlify.env.get("ADMIN_KEY");
  if (!adminKey) throw new Error("ADMIN_KEY is not configured.");
  const response = await fetch(siteUrl + "/api/admin/run", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": adminKey },
    body: "{}",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Daily picks workflow failed (${response.status}): ${detail}`);
  }
  console.log("Daily picks workflow completed:", await response.text());
};

export const config: Config = {
  schedule: "0 11 * * *", // 11:00 UTC = 6:00 AM New York in EST; 7:00 AM during EDT
};
/**
 * Refuse to start a browser run that cannot reach Supabase.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` is inlined into the bundle when it is built, so
 * the address the browser will use is a property of the build, not of the
 * environment the tests run in. On this project's Windows machine the address
 * has to be the LAN one rather than loopback (#79), and the subnet has moved
 * twice — once on 2026-09-23, costing half an hour of auth calls that hung,
 * and again on 2026-09-24, costing a ten-run measurement batch. Both times
 * every test failed inside `signIn` with "element(s) not found", which looks
 * exactly like a product fault and is not one.
 *
 * So this reads the address out of the running build's own JavaScript and
 * asks whether it answers. It fails the run in one line before any test
 * starts, instead of after forty minutes of misleading red.
 *
 * It states what it could not check rather than passing quietly: if the
 * bundle holds no Supabase address — a hosted build, or a bundle that has
 * changed shape — it says so and lets the run continue, because a preflight
 * that guesses is worse than none.
 */

const HEALTH_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

export default async function preflight() {
  const base = (process.env.QA_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

  let html: string;
  try {
    const response = await fetchWithTimeout(`${base}/sign-in`, HEALTH_TIMEOUT_MS);
    html = await response.text();
  } catch (error) {
    throw new Error(
      `Preflight: the application at ${base} did not answer (${String(error)}).\n` +
        "Start the server before running the browser suite.",
    );
  }

  const scripts = [...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1]);
  let supabaseUrl: string | null = null;
  for (const src of scripts) {
    let body: string;
    try {
      body = await (await fetchWithTimeout(base + src, HEALTH_TIMEOUT_MS)).text();
    } catch {
      continue;
    }
    const found = body.match(/https?:\/\/[A-Za-z0-9._-]+:54321/);
    if (found) {
      supabaseUrl = found[0];
      break;
    }
  }

  if (!supabaseUrl) {
    console.warn(
      "Preflight: no Supabase address found in the served bundle, so its " +
        "reachability was not checked. Continuing.",
    );
    return;
  }

  try {
    const health = await fetchWithTimeout(`${supabaseUrl}/auth/v1/health`, HEALTH_TIMEOUT_MS);
    if (!health.ok) {
      throw new Error(`answered ${health.status}`);
    }
  } catch (error) {
    throw new Error(
      `Preflight: this build talks to Supabase at ${supabaseUrl}, and that ` +
        `address did not answer (${String(error)}).\n` +
        "The bundle was built against an address that is no longer this " +
        "machine's — rebuild with the current one and restart the server. " +
        "Every test would otherwise fail inside signIn for a reason that has " +
        "nothing to do with the product.",
    );
  }

  console.log(`Preflight: Supabase at ${supabaseUrl} is reachable.`);
}

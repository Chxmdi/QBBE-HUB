// 50-user load test (#115, QA-FINAL "p95 interaction <= 2 s").
//
// Fifty virtual users, each signed in as a different performance fixture
// person, move through the screens people use most: the dashboard, My Work,
// the board, the project list, a project they work on, and the shared channel
// with its 1,000-message history. Each request is one full server render,
// authorization and all, which is what a person waits for.
//
// The run fails when the 95th percentile of any screen exceeds 2 s, when more
// than 1% of requests fail, or when a page answers with the sign-in screen
// instead of itself.
//
//   k6 run -e BASE_URL=http://127.0.0.1:3000 -e SESSIONS=perf-sessions.json \
//     [-e DURATION=2m] scripts/qa/perf.k6.js

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Trend } from "k6/metrics";

// Bytes of HTML each screen sends. Time says a screen is slow; size says how
// much of that is the page itself, and shows what a change saved (#115).
const pageBytes = new Trend("page_bytes");
const SCREENS = ["dashboard", "my-work", "board", "projects", "project", "channel"];

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3000";
const fixture = new SharedArray("fixture", () => [JSON.parse(open(__ENV.SESSIONS || "../../perf-sessions.json"))]);

export const options = {
  scenarios: {
    // People arrive over 30 s, then all fifty keep working for DURATION.
    // Starting all fifty in the same instant put every first request on the
    // dashboard at once, a burst no real morning produces, and that burst
    // alone set the dashboard's 95th percentile (#115).
    fifty_people: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: __ENV.DURATION || "2m", target: 50 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    "http_req_duration{screen:dashboard}": ["p(95)<2000"],
    "http_req_duration{screen:my-work}": ["p(95)<2000"],
    "http_req_duration{screen:board}": ["p(95)<2000"],
    "http_req_duration{screen:projects}": ["p(95)<2000"],
    "http_req_duration{screen:project}": ["p(95)<2000"],
    "http_req_duration{screen:channel}": ["p(95)<2000"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max"],
};
// Thresholds that always pass, only so the summary reports each screen's page
// size on its own line, and each screen's time on a person's first visit
// apart from later ones: a first visit meets a cold server, a later one does
// not, and one slow group can hide inside a single 95th percentile.
for (const screen of SCREENS) {
  options.thresholds[`page_bytes{screen:${screen}}`] = ["avg>=0"];
  options.thresholds[`http_req_duration{screen:${screen},visit:first}`] = ["avg>=0"];
  options.thresholds[`http_req_duration{screen:${screen},visit:repeat}`] = ["avg>=0"];
}

function visit(path, screen, cookie) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: { cookie },
    redirects: 0,
    tags: { screen, visit: __ITER === 0 ? "first" : "repeat" },
  });
  // A redirect is not a failed request to k6, so say where it went: that is
  // the difference between a sign-in bounce, the MFA gate and onboarding.
  if (response.status !== 200) {
    console.warn(`${screen} answered ${response.status} -> ${response.headers.Location ?? "(no location)"} (VU ${__VU}, iteration ${__ITER})`);
  }
  pageBytes.add(String(response.body ?? "").length, { screen });
  check(response, {
    [`${screen} answers 200`]: (r) => r.status === 200,
    [`${screen} is not the sign-in page`]: (r) => !String(r.body).includes('name="password"'),
  });
  // A person reads before the next click.
  sleep(1 + Math.random() * 2);
}

export default function () {
  const { users, projects, channel } = fixture[0];
  const me = users[(__VU - 1) % users.length];
  const project = projects[(__VU + __ITER) % projects.length];

  visit("/", "dashboard", me.cookie);
  visit("/my-work", "my-work", me.cookie);
  visit("/board", "board", me.cookie);
  visit("/projects", "projects", me.cookie);
  visit(`/projects/${project}`, "project", me.cookie);
  visit(`/channels/${channel}`, "channel", me.cookie);
}

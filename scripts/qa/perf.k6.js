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

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3000";
const fixture = new SharedArray("fixture", () => [JSON.parse(open(__ENV.SESSIONS || "../../perf-sessions.json"))]);

export const options = {
  scenarios: {
    fifty_people: {
      executor: "constant-vus",
      vus: 50,
      duration: __ENV.DURATION || "2m",
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

function visit(path, screen, cookie) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: { cookie },
    redirects: 0,
    tags: { screen },
  });
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

// A minimal round-robin HTTP proxy for the 50-user load test (#115).
//
// In production the app runs as many server instances. On the CI runner a
// single `next start` process is one Node.js thread, and the 2026-09-26 CPU
// profile showed it pinned at 94% of one core while the rest of the stack used
// about 1.5 of the other three. This spreads requests over several local
// instances so the test measures the app rather than one process.
//
//   node scripts/qa/round-robin.mjs <listen-port> <upstream-port> [...]

import http from "node:http";

const [listen, ...upstreams] = process.argv.slice(2).map(Number);
if (!listen || upstreams.length === 0) {
  console.error("usage: round-robin.mjs <listen-port> <upstream-port> [...]");
  process.exit(2);
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
let next = 0;

http
  .createServer((req, res) => {
    const port = upstreams[next++ % upstreams.length];
    const upstream = http.request(
      { host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers, agent },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) res.writeHead(502);
      res.end(`upstream ${port}: ${error.message}`);
    });
    req.pipe(upstream);
  })
  .listen(listen, "127.0.0.1", () => {
    console.log(`round-robin on ${listen} -> ${upstreams.join(", ")}`);
  });

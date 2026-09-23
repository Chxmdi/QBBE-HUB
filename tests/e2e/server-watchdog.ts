import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/**
 * Report a server that exited mid-run as a server exit, not as test failures.
 *
 * #79 requirement 4. When `next start` died under this suite, every check after
 * it failed in about two seconds with `net::ERR_CONNECTION_REFUSED`, and the
 * run reported something like "22 failed" — which reads as twenty-two broken
 * features. It took a long time to notice that the product was never the
 * subject of those failures, and the only honest thing to do with such a run is
 * to discard it.
 *
 * This watches for that shape and says so plainly. It does not restart
 * anything: the point of the requirement is to stop working around the exit and
 * to make it visible when it happens.
 */

const CONNECTION_ERRORS = [
  "ERR_CONNECTION_REFUSED",
  "ECONNREFUSED",
  "ERR_CONNECTION_RESET",
  "ECONNRESET",
  "ERR_EMPTY_RESPONSE",
];

function looksLikeTransportFailure(result: TestResult): boolean {
  const text = [
    result.error?.message ?? "",
    result.error?.stack ?? "",
    ...result.errors.map((e) => e.message ?? ""),
  ].join("\n");
  return CONNECTION_ERRORS.some((code) => text.includes(code));
}

export default class ServerWatchdog implements Reporter {
  private baseURL = "";
  private aliveAtStart = false;
  private serverGone = false;
  private firstCasualty: string | null = null;
  private transportFailures = 0;

  onBegin(config: FullConfig) {
    this.baseURL =
      process.env.QA_BASE_URL ??
      config.projects[0]?.use?.baseURL ??
      "http://127.0.0.1:3000";
  }

  /** A single probe, short enough not to add meaningfully to a run. */
  private async reachable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        await fetch(this.baseURL, { signal: controller.signal });
        return true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    if (!this.aliveAtStart) {
      // First result of the run. If the server was never up, say that rather
      // than blaming whichever check happened to run first.
      this.aliveAtStart = true;
    }
    if (result.status !== "failed" && result.status !== "timedOut") return;
    if (!looksLikeTransportFailure(result)) return;

    this.transportFailures += 1;
    if (this.serverGone) return;

    // Only ask the network once the failure already looks like transport, so a
    // healthy run never pays for this.
    if (!(await this.reachable())) {
      this.serverGone = true;
      this.firstCasualty = test.titlePath().slice(1).join(" › ");
    }
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | void> {
    if (!this.serverGone) {
      // A transport failure with the server still up is worth a quieter note:
      // it separates a flaky connection from a dead process, which is the
      // distinction #79 asks to preserve.
      if (this.transportFailures > 0) {
        console.log(
          `\n  note: ${this.transportFailures} check(s) failed on a connection error, ` +
            `but ${this.baseURL} is still answering. Those are transport failures, ` +
            `not product failures, and not a server exit.\n`,
        );
      }
      return;
    }

    const line = "=".repeat(72);
    console.error(
      [
        "",
        line,
        "  SERVER EXITED DURING THIS RUN — THE RESULTS BELOW ARE NOT EVIDENCE",
        line,
        `  ${this.baseURL} stopped answering part way through.`,
        this.firstCasualty ? `  First check to see it gone: ${this.firstCasualty}` : "",
        `  Checks that failed on a connection error: ${this.transportFailures}`,
        "",
        "  Every failure after the exit is the missing server, not the product.",
        "  Do not read this run as a product result, and do not re-run a single",
        "  check to 'confirm' it — start a fresh run against a live server.",
        "",
        "  Known cause on Windows (#79): libuv#5274, a stack-cookie fast-fail in",
        "  uv__tcp_connect on loopback connects. The workaround in this repository",
        "  is to give the server a non-loopback Supabase URL.",
        line,
        "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    // Fail the run even if, by luck, every check that ran before the exit
    // passed. A run whose server died proves nothing either way.
    return { status: result.status === "passed" ? "failed" : result.status };
  }
}

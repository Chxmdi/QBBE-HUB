import { describe, expect, it } from "vitest";
import { JOB_RUNNER_FIX } from "@/features/jobs/services/runner-status";
import { en } from "@/lib/i18n/messages/en";
import { frCA } from "@/lib/i18n/messages/fr-CA";

// The admin Jobs banner reads its advice from the catalogue (#141). The
// English there must stay the advice runner-status.ts documents, and every
// status that can show the banner needs a French line too.
describe("job runner banner text", () => {
  it("matches JOB_RUNNER_FIX in English and covers every status in French", () => {
    // The not_configured advice ends with the SQL to run, shown as code.
    const english = {
      ...en.jobs.runner.fix,
      not_configured: `${en.jobs.runner.fix.not_configured} ${en.jobs.runner.command}`,
    };
    expect(english).toEqual(JOB_RUNNER_FIX);
    expect(Object.keys(frCA.jobs.runner.fix).sort()).toEqual(Object.keys(JOB_RUNNER_FIX).sort());
  });
});

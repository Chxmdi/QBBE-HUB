import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { mobileT } from "@/features/mobile/i18n";
import { captureProjects } from "@/features/mobile/services/mobile.queries";
import { CaptureForm } from "@/features/mobile/components/capture-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: mobileT(await getLocale())("capture.title") };
}

export default async function PhoneCapture() {
  const session = await requireSession();
  const t = mobileT(await getLocale());
  const projects = await captureProjects();
  return (
    <div className="space-y-4">
      <h1 className="page-title">{t("capture.title")}</h1>
      <p className="text-sm text-muted">{t("capture.description")}</p>
      {projects.length === 0 ? (
        <p className="card p-4 text-sm text-ink">{t("capture.noProjects")}</p>
      ) : (
        <CaptureForm userId={session.userId} projects={projects} />
      )}
    </div>
  );
}

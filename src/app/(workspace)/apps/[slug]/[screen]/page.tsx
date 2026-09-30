import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppActionButton } from "@/features/apps/components/app-action-button";
import { AppScreenView } from "@/features/apps/components/app-screen";
import { appsMessages, fill, pick } from "@/features/apps/i18n";
import { actionsFor, appCapabilityFor, navigation, validateAppDefinition } from "@/features/apps/schema";
import { canUseApp, getApp } from "@/features/apps/services/app.queries";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale, getT } from "@/lib/i18n/server";
import { createTaskQueryStub } from "@/lib/objects/stubs";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; screen: string }>;

async function load(params: Params) {
  const { slug, screen: screenKey } = await params;
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  if (!(await isEnabled("wos_objects", supabase))) notFound();
  const app = await getApp(supabase, session.organizationId, { slug });
  const validation = app ? validateAppDefinition(app.definition) : null;
  if (!app || !validation?.ok) notFound();
  const screen = validation.app.screens.find((s) => s.key === screenKey);
  if (!screen) notFound();
  return { session, supabase, app, definition: validation.app, screen };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await getLocale();
  const { app, screen } = await load(params);
  return { title: `${pick(screen.title, locale)} · ${locale === "fr-CA" ? app.nameFr : app.nameEn}` };
}

/** An app's own shell: its menu, the chosen screen, and the actions that screen offers. */
export default async function AppScreenPage({ params }: { params: Params }) {
  const { session, supabase, app, definition, screen } = await load(params);
  const locale = await getLocale();
  const messages = appsMessages(locale);
  const t = await getT();
  const name = locale === "fr-CA" ? app.nameFr : app.nameEn;
  const query = createTaskQueryStub(supabase, { userId: session.userId, timeZone: session.timeZone });

  // Only offer the actions this person could run here; the registry re-checks every target.
  const actions = (
    await Promise.all(
      actionsFor(definition, screen.key).map(async (action) =>
        (await canUseApp(supabase, app.id, appCapabilityFor(action.capability))) ? action : null,
      ),
    )
  ).filter((a) => a !== null);

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav aria-label={fill(messages.shell.navigation, { name })} className="md:w-52 md:shrink-0">
        <p className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">{name}</p>
        <ul className="flex flex-wrap gap-1 md:flex-col">
          {navigation(definition).map((item) => {
            const current = item.key === screen.key;
            return (
              <li key={item.key}>
                <Link
                  href={`/apps/${app.slug}/${item.key}`}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "block rounded-(--radius-sm) px-3 py-1.5 text-[13.5px]",
                    current ? "bg-brand-soft font-medium text-brand-fg" : "text-ink hover:bg-surface-soft",
                  )}
                >
                  {pick(item.title, locale)}
                </Link>
              </li>
            );
          })}
        </ul>
        {session.isAdmin ? (
          <Link href={`/apps/manage/${app.id}`} className="mt-4 block px-3 text-[13px] text-brand-fg hover:underline">
            {messages.shell.manage}
          </Link>
        ) : null}
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="page-title">{pick(screen.title, locale)}</h1>
          {actions.length ? (
            <section aria-label={messages.shell.actions} className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <AppActionButton
                  key={action.key}
                  slug={app.slug}
                  actionKey={action.key}
                  label={pick(action.label, locale)}
                  doneText={messages.runAction.done}
                />
              ))}
            </section>
          ) : null}
        </div>
        <AppScreenView screen={screen} query={query} messages={messages} locale={locale} t={t} />
      </div>
    </div>
  );
}

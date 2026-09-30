import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { CommandBar } from "@/features/commands/components/command-bar";
import { commandsT } from "@/features/commands/i18n";
import { HomeTabs } from "@/features/home/components/home-tabs";
import { homeT } from "@/features/home/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: commandsT(await getLocale())("bar.title") };
}
export const dynamic = "force-dynamic";

const EXAMPLES = {
  en: [
    "create project Spring gala",
    'assign "Book the hall" to Ada',
    'move "Book the hall" to in progress',
    "show blocked tasks",
    "open Fall Community Workshop Series",
    "add Ada to Youth Programs",
  ],
  "fr-CA": [
    "créer un projet Gala du printemps",
    "assigner « Réserver la salle » à Ada",
    "déplacer « Réserver la salle » vers en cours",
    "afficher les tâches bloquées",
    "ouvrir Fall Community Workshop Series",
    "ajouter Ada à Youth Programs",
  ],
};

/**
 * The command language on a page of its own (M15), behind the Home switch.
 * Integration mounts <CommandBar> in the ⌘K palette; this page is where it
 * can be used and tested until then.
 */
export default async function CommandsPage() {
  await requireSession();
  if (!(await isEnabled("wos_home"))) notFound();
  const locale = await getLocale();
  const t = commandsT(locale);
  const examples = EXAMPLES[locale];
  return (
    <div>
      <PageHeader title={t("bar.title")} description={t("bar.description")} />
      <HomeTabs active="commands" t={homeT(locale)} />
      <CommandBar autoFocus />
      <section aria-labelledby="command-examples" className="mt-8 max-w-2xl">
        <h2 id="command-examples" className="text-sm font-semibold text-ink">
          {t("bar.examples")}
        </h2>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {examples.map((example) => (
            <li key={example}>
              <code>{example}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

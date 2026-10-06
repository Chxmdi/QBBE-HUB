"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { fill, type FollowingText } from "@/features/following/messages";
import {
  EVENT_KINDS,
  RULE_CHOICES,
  type EventKind,
  type PresetQueryKey,
  type RuleChoice,
} from "@/features/following/rules";
import {
  followObject,
  followPresetQuery,
  saveFollowRules,
  unfollow,
} from "@/features/following/services/following.commands";

function useAction(text: FollowingText) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: done } : { ok: false, text: result.error ?? text.errors.generic });
    if (result.ok) router.refresh();
  }
  const feedback = message ? (
    <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-success-fg" : "text-sm text-danger-fg"}>
      {message.text}
    </p>
  ) : null;
  return { busy, run, feedback };
}

/**
 * Follow a task or project. Exported for the object screens to mount (the
 * Following page uses it for ?follow= links until integration adds it there).
 */
export function FollowButton({
  objectId,
  objectType,
  name,
  text,
}: {
  objectId: string;
  objectType: "task" | "project";
  name: string;
  text: FollowingText;
}) {
  const { busy, run, feedback } = useAction(text);
  return (
    <div className="space-y-2">
      <Button size="sm" loading={busy} onClick={() => run(() => followObject(objectId, objectType), fill(text.followed, { name }))}>
        <Bell className="size-4" aria-hidden />
        {text.follow}
      </Button>
      {feedback}
    </div>
  );
}

export function UnfollowButton({ followId, name, text }: { followId: string; name: string; text: FollowingText }) {
  const { busy, run, feedback } = useAction(text);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => unfollow(followId), text.unfollowed)}>
        {fill(text.unfollow, { name })}
      </Button>
      {feedback}
    </div>
  );
}

export function FollowQueryForm({ text, followed }: { text: FollowingText; followed: string[] }) {
  const id = useId();
  const { busy, run, feedback } = useAction(text);
  const options = (Object.keys(text.presets) as PresetQueryKey[]).filter((key) => !followed.includes(key));
  const [choice, setChoice] = useState<PresetQueryKey | "">(options[0] ?? "");
  if (options.length === 0) return null;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice) void run(() => followPresetQuery(choice), fill(text.followed, { name: text.presets[choice] }));
      }}
    >
      <div className="min-w-60">
        <Label htmlFor={`${id}-query`}>{text.kinds.query}</Label>
        <Select id={`${id}-query`} value={choice} onChange={(e) => setChoice(e.target.value as PresetQueryKey)}>
          {options.map((key) => (
            <option key={key} value={key}>
              {text.presets[key]}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" size="md" loading={busy}>
        {text.followQuery}
      </Button>
      <div className="basis-full">{feedback}</div>
    </form>
  );
}

export function FollowRulesForm({ text, initial }: { text: FollowingText; initial: Record<EventKind, RuleChoice> }) {
  const id = useId();
  const [choices, setChoices] = useState(initial);
  const { busy, run, feedback } = useAction(text);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveFollowRules(choices), text.rulesSaved);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {EVENT_KINDS.map((kind) => (
          <div key={kind}>
            <Label htmlFor={`${id}-${kind}`}>{text.events[kind]}</Label>
            <Select
              id={`${id}-${kind}`}
              value={choices[kind]}
              onChange={(e) => setChoices((c) => ({ ...c, [kind]: e.target.value as RuleChoice }))}
            >
              {RULE_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {text.choices[choice]}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
      <Button type="submit" loading={busy}>
        {text.saveRules}
      </Button>
      {feedback}
    </form>
  );
}

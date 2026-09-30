"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label } from "@/components/ui/input";
import type { ApiTokensMessages } from "../i18n";
import { createApiToken, revokeApiToken } from "../services/token.commands";
import { apiScopes, type ApiScope } from "../scopes";

const sectionClass = "rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5";

export function CreateTokenForm({ m }: { m: ApiTokensMessages }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<ApiScope[]>(["objects:read"]);
  const [days, setDays] = React.useState(90);
  const [token, setToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setToken(null);
    start(async () => {
      const result = await createApiToken({ name, scopes, days });
      if (result.ok) {
        setToken(result.token);
        setName("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <section className={sectionClass} aria-labelledby="token-create">
      <h2 id="token-create" className="section-heading mb-3">{m.create.heading}</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="token-name">{m.create.name}</Label>
          <Input id="token-name" required maxLength={80} value={name} aria-describedby="token-name-hint"
            onChange={(event) => setName(event.target.value)} />
          <p id="token-name-hint" className="mt-1 text-[12.5px] text-muted">{m.create.nameHint}</p>
        </div>
        <div>
          <Label htmlFor="token-days">{m.create.days}</Label>
          <Input id="token-days" type="number" min={1} max={365} required value={days} aria-describedby="token-days-hint"
            onChange={(event) => setDays(Number(event.target.value))} />
          <p id="token-days-hint" className="mt-1 text-[12.5px] text-muted">{m.create.daysHint}</p>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">{m.create.scopes}</legend>
          <div className="flex flex-col gap-2">
            {apiScopes.map((scope) => (
              <label key={scope} className="inline-flex items-center gap-2 text-sm text-ink">
                <Checkbox checked={scopes.includes(scope)} onChange={(event) =>
                  setScopes(event.target.checked ? [...scopes, scope] : scopes.filter((existing) => existing !== scope))} />
                <span><code className="text-[12.5px]">{scope}</code> · {m.scopes[scope]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Button type="submit" loading={pending} disabled={scopes.length === 0}>{m.create.submit}</Button>
        </div>
      </form>
      <div role="status" className="mt-3">
        {token ? (
          <div>
            <p className="mb-1 text-sm font-medium text-ink">{m.create.shownOnce}</p>
            <Label htmlFor="token-value">{m.create.tokenLabel}</Label>
            <Input id="token-value" readOnly value={token} className="font-mono text-[13px]" onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p> : null}
    </section>
  );
}

export function RevokeButton({ id, label, m }: { id: string; label: string; m: ApiTokensMessages }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="secondary" loading={pending} aria-label={label}
        onClick={() => start(async () => {
          const result = await revokeApiToken({ id });
          if (result.ok) router.refresh();
          else setError(result.error);
        })}>
        {m.list.revokeLabel}
      </Button>
      {error ? <span role="alert" className="text-[13px] text-danger-fg">{error}</span> : null}
    </span>
  );
}

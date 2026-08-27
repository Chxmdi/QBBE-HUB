-- QBBE Hub — the funding and partnership pipeline.
--
-- The CRM already records who QBBE knows (crm_organization), who to speak to
-- (crm_contact), what was said (crm_interaction) and what to do next
-- (crm_follow_up). What it cannot answer is the question a trustee actually
-- asks: what money is in play, at what stage, and when do we hear back.
--
-- An opportunity is one funding or partnership conversation with a decision at
-- the end of it — a grant application, a sponsorship, a service contract, a
-- donation, an in-kind offer. It is deliberately not a generic "deal": the
-- stages are the stages a small charity's bid actually passes through.
--
-- What this is NOT: forecasting. `docs/spec-coverage.md` defers opportunity
-- forecasting (P2-CRM-07) out of the first release, so there is no probability
-- field and no weighted pipeline value here. Stage says where a bid is, amount
-- says what is at stake, and the sum of awarded amounts is a fact rather than
-- a projection. Adding a probability column later is an additive migration;
-- unpicking a forecast people have started trusting is not.
--
-- Access follows the rest of the CRM exactly: staff and above, scoped to the
-- owning organization. Funding conversations are commercially sensitive and a
-- volunteer has no business reading them.

create type opportunity_kind as enum (
  'grant', 'sponsorship', 'contract', 'donation', 'partnership', 'in_kind'
);

-- The order matters: it is the order a bid moves through, and `stage` is
-- compared with `>=` nowhere, so the enum order is documentation rather than
-- logic. Settled stages sit at the end.
create type opportunity_stage as enum (
  'identified', 'qualifying', 'preparing', 'submitted',
  'awarded', 'declined', 'withdrawn'
);

create table opportunity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  -- An opportunity is always with somebody. A funder that leaves the CRM takes
  -- its pipeline with it, which is why this cascades rather than nulls.
  crm_organization_id uuid not null references crm_organization (id) on delete cascade,
  contact_id uuid references crm_contact (id) on delete set null,

  title text not null,
  description text,
  kind opportunity_kind not null default 'grant',
  stage opportunity_stage not null default 'identified',

  -- Money is stored to the penny in the currency it was asked for. A charity
  -- applying to an international funder is not rare enough to assume GBP.
  currency char(3) not null default 'GBP',
  amount_requested numeric(12, 2),
  amount_awarded numeric(12, 2),

  -- What the money would pay for, when that is already known.
  program_id uuid references program (id) on delete set null,
  project_id uuid references project (id) on delete set null,

  -- Somebody is accountable for every live bid, so this is required. The rest
  -- of the CRM allows unowned rows; a bid nobody owns is a bid nobody submits.
  owner_id uuid not null references user_profile (id),

  submitted_at date,
  decision_expected_at date,
  decided_at date,
  outcome_note text,

  created_by uuid references user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- "Is this still in play" is asked by every list, chart and total in the
  -- product. Deriving it here means no two of them can disagree.
  is_open boolean generated always as (
    stage not in ('awarded', 'declined', 'withdrawn')
  ) stored,

  constraint amounts_are_not_negative check (
    coalesce(amount_requested, 0) >= 0 and coalesce(amount_awarded, 0) >= 0
  ),
  -- ISO 4217, so the column can be joined against anything later.
  constraint currency_is_an_iso_code check (currency ~ '^[A-Z]{3}$'),

  -- An award is a number and a date, or it is a rumour.
  constraint awarded_opportunities_record_the_amount check (
    stage <> 'awarded' or (amount_awarded is not null and decided_at is not null)
  ),
  -- A refusal is worth more than its status: the reason is what shapes the
  -- next application to the same funder.
  constraint refused_opportunities_explain_themselves check (
    stage not in ('declined', 'withdrawn')
      or (outcome_note is not null and decided_at is not null)
  ),
  -- No decision date on something still in play, and no award on something
  -- that was not awarded — both would quietly corrupt any total.
  constraint open_opportunities_have_no_decision check (
    stage in ('awarded', 'declined', 'withdrawn') or decided_at is null
  ),
  constraint only_awards_have_an_awarded_amount check (
    stage = 'awarded' or amount_awarded is null
  ),
  constraint decisions_follow_submissions check (
    decided_at is null or submitted_at is null or decided_at >= submitted_at
  )
);

create index idx_opportunity_org on opportunity (organization_id, stage);
create index idx_opportunity_crm on opportunity (crm_organization_id, stage);
create index idx_opportunity_owner on opportunity (owner_id, stage);
-- The pipeline view: what is live, soonest decision first.
create index idx_opportunity_open on opportunity (organization_id, decision_expected_at)
  where is_open;
create index idx_opportunity_program on opportunity (program_id) where program_id is not null;
create index idx_opportunity_project on opportunity (project_id) where project_id is not null;

create trigger trg_opportunity_updated_at before update on opportunity
  for each row execute function set_updated_at();

comment on table opportunity is
  'A funding or partnership conversation with a decision at the end of it.';
comment on column opportunity.is_open is
  'Derived from stage, so every list and total agrees on what is still in play.';
comment on column opportunity.amount_awarded is
  'Set only when the stage is awarded; the constraint keeps totals honest.';

alter table opportunity enable row level security;

-- Identical to the rest of the CRM: staff and above, own organization only.
create policy opportunity_staff on opportunity for all to authenticated
  using (app.is_org_staff(organization_id))
  with check (app.is_org_staff(organization_id));

import { z } from "zod";

/**
 * The parts of Zeffy's public API (https://www.zeffy.com/api/docs) the Hub
 * reads. Zod drops fields the Hub does not use, so a field Zeffy adds later
 * changes nothing here, and every field the Hub reads may be missing or null
 * without failing the whole page of results.
 */

const text = z.string().nullable().optional();
const unix = z.number().nullable().optional();

export const zeffyItemSchema = z.object({
  type: text,
  amount: z.number().nullable().optional(),
  rate_title: text,
  parent_rate_title: text,
});

export const zeffyPaymentSchema = z.object({
  id: z.string().min(1),
  created: z.number(),
  amount: z.number(),
  eligible_amount: z.number().nullable().optional(),
  currency: z.string().min(1),
  status: z.string().min(1),
  type: text,
  refund_status: text,
  refunds: z
    .array(z.object({ amount: z.number().nullable().optional(), status: text }))
    .nullable()
    .optional(),
  dispute: z.object({ status: text }).nullable().optional(),
  description: text,
  contact: text,
  buyer: z
    .object({
      email: text,
      first_name: text,
      last_name: text,
      is_corporate: z.boolean().nullable().optional(),
      company_name: text,
    })
    .nullable()
    .optional(),
  campaign_id: text,
  campaign_category: text,
  items: z.array(zeffyItemSchema).nullable().optional(),
  receipt_url: text,
  recurring: z
    .object({ is_recurring: z.boolean().nullable().optional(), status: text, interval: text })
    .nullable()
    .optional(),
  fund: z
    .object({ code: text, name: z.record(z.string(), z.string().nullable()).nullable().optional() })
    .nullable()
    .optional(),
});

export const zeffyContactSchema = z.object({
  id: z.string().min(1),
  created: unix,
  updated: unix,
  email: text,
  first_name: text,
  last_name: text,
  phone_number: text,
});

export const zeffyCampaignSchema = z.object({
  id: z.string().min(1),
  created: unix,
  updated: unix,
  deleted_at: unix,
  type: text,
  category: text,
  status: text,
  title: text,
  url: text,
  goal_amount: z.number().nullable().optional(),
  target: z.number().nullable().optional(),
  volume: z.number().nullable().optional(),
  currency: text,
  is_archived: z.boolean().nullable().optional(),
  start_date: unix,
  end_date: unix,
});

export const zeffyListSchema = z.object({
  data: z.array(z.unknown()),
  has_more: z.boolean().optional().default(false),
  next_cursor: z.string().nullable().optional(),
});

export type ZeffyPayment = z.infer<typeof zeffyPaymentSchema>;
export type ZeffyContact = z.infer<typeof zeffyContactSchema>;
export type ZeffyCampaign = z.infer<typeof zeffyCampaignSchema>;

/** What a supporter did through Zeffy; shown to staff, carries no amount. */
export const ZEFFY_KINDS = [
  "donor",
  "recurring",
  "ticket",
  "member",
  "shop",
  "auction",
  "raffle",
  "other",
] as const;
export type ZeffyKind = (typeof ZEFFY_KINDS)[number];

export interface ZeffyPaymentRow {
  organization_id: string;
  zeffy_id: string;
  zeffy_contact_id: string | null;
  zeffy_campaign_id: string | null;
  campaign_title: string | null;
  campaign_category: string | null;
  paid_at: string;
  amount_cents: number;
  eligible_amount_cents: number | null;
  refunded_cents: number;
  currency: string;
  status: string;
  payment_type: string | null;
  refund_status: string;
  dispute_status: string | null;
  is_recurring: boolean;
  recurring_interval: string | null;
  recurring_status: string | null;
  fund_code: string | null;
  fund_names: Record<string, string> | null;
  receipt_url: string | null;
  company_name: string | null;
  item_kinds: ZeffyKind[];
  items: { type: string | null; amount_cents: number | null; title: string | null }[];
  deleted_at: null;
  synced_at: string;
}

export interface ZeffyCampaignRow {
  organization_id: string;
  zeffy_id: string;
  campaign_type: string | null;
  category: string | null;
  status: string | null;
  title: string;
  url: string | null;
  goal_cents: number | null;
  raised_cents: number | null;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_archived: boolean;
  deleted_at: string | null;
  synced_at: string;
}

/** Who paid, as the Hub keeps it: enough to find or create a CRM contact. */
export interface ZeffyBuyer {
  zeffyContactId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

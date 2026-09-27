import { centsToDecimal } from "@/features/ledger/money";
import type { Direction, TaxCode } from "@/features/sales-tax/return-lines";

/** Form values of one tax line; amounts as the decimals a person types. */
export interface LineValues {
  id?: string;
  direction: Direction;
  taxCode: TaxCode;
  transactionDate: string;
  counterparty: string;
  reference: string;
  description: string;
  amount: string;
  gst: string;
  qst: string;
  itc: string;
  itr: string;
}

/** A stored line as form values, for editing. */
export function lineValues(line: {
  id: string;
  direction: Direction;
  tax_code: TaxCode;
  transaction_date: string;
  counterparty: string;
  reference: string | null;
  description: string | null;
  amount_cents: number;
  gst_cents: number;
  qst_cents: number;
  itc_cents: number;
  itr_cents: number;
}): LineValues {
  return {
    id: line.id,
    direction: line.direction,
    taxCode: line.tax_code,
    transactionDate: line.transaction_date,
    counterparty: line.counterparty,
    reference: line.reference ?? "",
    description: line.description ?? "",
    amount: centsToDecimal(line.amount_cents),
    gst: centsToDecimal(line.gst_cents),
    qst: centsToDecimal(line.qst_cents),
    itc: centsToDecimal(line.itc_cents),
    itr: centsToDecimal(line.itr_cents),
  };
}

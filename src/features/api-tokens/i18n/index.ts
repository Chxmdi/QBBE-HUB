import type { Locale } from "@/lib/i18n/config";
import { apiTokensEn, type ApiTokensMessages } from "./api-tokens.en";
import { apiTokensFrCA } from "./api-tokens.fr-CA";

export type { ApiTokensMessages };

/** The private API screens' own dictionaries, until integration mounts them. */
export function apiTokenMessages(locale: Locale): ApiTokensMessages {
  return locale === "fr-CA" ? apiTokensFrCA : apiTokensEn;
}

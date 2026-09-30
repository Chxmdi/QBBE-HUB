import { createModuleTranslator } from "./translator";
import { mobileEn } from "./en";
import { mobileFrCA } from "./fr-CA";

export const mobileT = createModuleTranslator({ en: mobileEn, "fr-CA": mobileFrCA });
export type MobileT = ReturnType<typeof mobileT>;

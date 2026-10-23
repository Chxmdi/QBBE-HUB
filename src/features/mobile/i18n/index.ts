import { createModuleTranslator } from "./translator";
import { catalogues } from "./catalogues";

const mobileEn = catalogues.en;
const mobileFrCA = catalogues["fr-CA"];

export const mobileT = createModuleTranslator({ en: mobileEn, "fr-CA": mobileFrCA });
export type MobileT = ReturnType<typeof mobileT>;

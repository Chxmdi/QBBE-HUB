import { createModuleTranslator } from "./translator";
import { catalogues } from "./catalogues";

const decisionsV2En = catalogues.en;
const decisionsV2FrCA = catalogues["fr-CA"];

export const decisionsV2T = createModuleTranslator({ en: decisionsV2En, "fr-CA": decisionsV2FrCA });
export type DecisionsV2T = ReturnType<typeof decisionsV2T>;

import { createModuleTranslator } from "./translator";
import { decisionsV2En } from "./en";
import { decisionsV2FrCA } from "./fr-CA";

export const decisionsV2T = createModuleTranslator({ en: decisionsV2En, "fr-CA": decisionsV2FrCA });
export type DecisionsV2T = ReturnType<typeof decisionsV2T>;

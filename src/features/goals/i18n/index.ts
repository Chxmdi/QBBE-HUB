import { createModuleTranslator } from "./translator";
import { goalsEn } from "./en";
import { goalsFrCA } from "./fr-CA";

export const goalsT = createModuleTranslator({ en: goalsEn, "fr-CA": goalsFrCA });
export type GoalsT = ReturnType<typeof goalsT>;

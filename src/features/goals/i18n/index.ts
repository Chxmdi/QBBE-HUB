import { createModuleTranslator } from "./translator";
import { catalogues } from "./catalogues";

const goalsEn = catalogues.en;
const goalsFrCA = catalogues["fr-CA"];

export const goalsT = createModuleTranslator({ en: goalsEn, "fr-CA": goalsFrCA });
export type GoalsT = ReturnType<typeof goalsT>;

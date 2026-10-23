import { createModuleTranslator } from "./translator";
import { catalogues } from "./catalogues";

const objectApprovalsEn = catalogues.en;
const objectApprovalsFrCA = catalogues["fr-CA"];

export const objectApprovalsT = createModuleTranslator({ en: objectApprovalsEn, "fr-CA": objectApprovalsFrCA });
export type ObjectApprovalsT = ReturnType<typeof objectApprovalsT>;

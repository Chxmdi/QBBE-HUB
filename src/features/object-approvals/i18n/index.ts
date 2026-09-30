import { createModuleTranslator } from "./translator";
import { objectApprovalsEn } from "./en";
import { objectApprovalsFrCA } from "./fr-CA";

export const objectApprovalsT = createModuleTranslator({ en: objectApprovalsEn, "fr-CA": objectApprovalsFrCA });
export type ObjectApprovalsT = ReturnType<typeof objectApprovalsT>;

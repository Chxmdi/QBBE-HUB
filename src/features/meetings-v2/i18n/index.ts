import { createModuleTranslator } from "./translator";
import { meetingsV2En } from "./en";
import { meetingsV2FrCA } from "./fr-CA";

/** `t()` for this module in a given language; works on the server and the client. */
export const meetingsV2T = createModuleTranslator({ en: meetingsV2En, "fr-CA": meetingsV2FrCA });
export type MeetingsV2T = ReturnType<typeof meetingsV2T>;

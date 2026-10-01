import type { ObjectRef } from "@/lib/objects/contracts";

/** The screen where an object's content is edited, for types that have one. */
export function objectContentPath(object: ObjectRef): string | null {
  switch (object.type) {
    case "page":
      return `/pages/${object.id}`;
    case "meeting":
      return `/meetings-v2/${object.id}`;
    default:
      return null;
  }
}

/** English text for presence, cursors and page lock (V1-17). */
export const collabEn = {
  presence: {
    label: "People here now",
    alone: "Only you are here.",
    you: "You",
    editing: "{name} (editing)",
    viewing: "{name} (viewing)",
    cursor: "{name} is at character {offset} of {block}",
    selecting: "{name} has {length} characters selected in {block}",
    others: "{count} others here",
    offline: "Live updates are paused. Retrying…",
  },
  lock: {
    lock: "Lock page",
    unlock: "Unlock page",
    reasonLabel: "Why lock it? (optional)",
    locked: "Locked by {name}",
    lockedReason: "Locked by {name}: {reason}",
    lockedHint: "Nobody can change the content until it is unlocked.",
    formerMember: "a former member",
    failed: "That didn't work. Try again.",
  },
  page: {
    title: "Live editing",
    description: "See who else is here and where they are working.",
    notFound: "This item does not exist or you can't open it.",
    blocks: {
      description: "Description",
    },
  },
} as const;

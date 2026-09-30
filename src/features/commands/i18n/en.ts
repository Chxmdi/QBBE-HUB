/** Command language: English source catalogue (M15). */
export const commandsEn = {
  bar: {
    title: "Commands",
    description:
      "Type a command, for example: assign \"Book the hall\" to Ada. Commands work in English and French.",
    label: "Command",
    placeholder: "create project, assign, move, show blocked tasks, open, add…",
    suggestions: "Suggestions",
    run: "Run",
    running: "Running…",
    hint: "Up and down arrows move through suggestions, Enter chooses one, Escape closes the list.",
    examples: "Examples",
    count: "{count} suggestions available.",
  },
  slot: {
    command: "Command",
    name: "Name",
    space: "Space",
    task: "Task",
    person: "Person",
    status: "Status",
    target: "Open",
    reason: "Reason",
  },
  result: {
    projectCreated: "Project “{name}” created.",
    taskAssigned: "Task assigned.",
    taskMoved: "Task moved.",
    personAdded: "Person added to the space.",
    opening: "Opening…",
  },
  errors: {
    empty: "Type a command.",
    unknown: "That is not a command. Try “create project”, “assign”, “move”, “show blocked tasks”, “open” or “add”.",
    incomplete: {
      name: "Add the project's name.",
      space: "Add the space's name.",
      task: "Add the task's title, in quotes, followed by “to”.",
      person: "Add the person's name.",
      status: "Add a status, for example “in progress”.",
      target: "Add what to open.",
      reason: "Say why it is blocked: add “because” and the reason.",
    },
    unknownStatus: "“{status}” is not a status. Try “not started”, “in progress”, “waiting”, “in review”, “completed” or “blocked”.",
    notFound: "No {slot} you can see is called “{name}”.",
    ambiguous: "More than one {slot} matches “{name}”: {candidates}. Type more of the name.",
    failed: "The command could not be run: {message}",
    unavailable: "Commands are not turned on.",
  },
} as const;

export type CommandsMessages = typeof commandsEn;

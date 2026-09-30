/** English strings for the Insight stream. French in ./fr-CA.ts, same keys. */
export const insightEn = {
  common: {
    eyebrow: "Insight",
    apply: "Apply",
    types: {
      program: "Programme",
      project: "Project",
      milestone: "Milestone",
      task: "Task",
      event: "Event",
    },
  },
  graph: {
    title: "Relationship graph",
    description: "How programmes, projects, milestones and tasks connect. Choose an object to centre on and how many steps out to show.",
    filters: "Graph filters",
    typesLegend: "Show these types",
    root: "Centre on",
    rootAll: "Everything (no centre)",
    depth: "Steps out",
    depthOption: "{count} steps",
    depthOne: "1 step",
    viewLabel: "View",
    viewGraph: "Graph",
    viewList: "List",
    summary: "{nodes} objects and {edges} links shown.",
    truncated: "This workspace is large, so only the most recent objects are included.",
    graphLabel: "Graph of {nodes} objects and {edges} links. The list view has the same information as text.",
    centreHere: "Centre the graph on {title}",
    open: "Open {title}",
    emptyTitle: "Nothing to show",
    emptyDescription: "No objects match these filters, or you do not have access to any yet.",
    relation: {
      containsOut: "contains",
      containsIn: "is inside",
      blocksOut: "blocks",
      blocksIn: "is blocked by",
    },
    legendContains: "Solid line: contains",
    legendBlocks: "Dashed line: blocks",
  },
};

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type InsightMessages = Shape<typeof insightEn>;

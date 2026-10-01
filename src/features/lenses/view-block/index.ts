/**
 * The generic view block (U6): a read-only lens in a page. The editor's
 * `query` block stores `ViewBlockProps` (version 2) in `props.spec` and
 * renders `<ViewBlock blockId config editable onChange />`.
 */
export { ViewBlock, type ViewBlockComponentProps } from "./view-block";
export { ViewConfig } from "./view-config";
export {
  calendarPath,
  composeSpec,
  conditionToNode,
  DEFAULT_DATE,
  DEFAULT_GROUP,
  FLAT_OPERATORS,
  parseViewBlockProps,
  readStoredViewBlock,
  VIEW_BLOCK_LIMITS,
  VIEW_BLOCK_VERSION,
  VIEW_LAYOUTS,
  viewBlockPropsSchema,
  viewConditionSchema,
  type ParsedViewBlockProps,
  type ViewBlockProps,
  type ViewCondition,
  type ViewLayout,
  type ViewSource,
} from "./schema";
export {
  localFiltersKey,
  mergeLocalFilters,
  readLocalFilters,
  setLocalFilter,
  writeLocalFilters,
  type LocalFilter,
} from "./local-filters";

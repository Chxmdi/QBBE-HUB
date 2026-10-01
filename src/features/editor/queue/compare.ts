import { blockText, walkBlocks, type EditorContent } from "@/features/editor/adapter/content";
import type { ContentSnapshot } from "@/features/versions/content";
import { diffSnapshots, type SnapshotDiff } from "@/features/versions/diff";

/**
 * A document as the flat block list the versions feature compares (M16b):
 * one entry per block in document order, with the block's own text (not its
 * children's, which are entries of their own). Blocks keep their editor ids,
 * so an edited block lines up with itself; a block without one is named by
 * its position.
 */
export function contentToSnapshot(content: EditorContent): ContentSnapshot {
  return {
    version: 1,
    blocks: walkBlocks(content.blocks).map(({ block }, index) => ({
      id: block.id || `block-${index + 1}`,
      type: block.type,
      text: blockText({ ...block, children: [] }),
      props: block.props,
    })),
  };
}

/** Theirs (the server's) on the left, mine (this device's) on the right. */
export function diffContents(theirs: EditorContent, mine: EditorContent): SnapshotDiff {
  return diffSnapshots(
    { content: contentToSnapshot(theirs), properties: {} },
    { content: contentToSnapshot(mine), properties: {} },
  );
}

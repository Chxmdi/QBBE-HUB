"use client";

import * as React from "react";
import type { BlockConfigOrCreator } from "@blocknote/core";
import type { ReactCustomBlockImplementation, ReactCustomBlockRenderProps } from "@blocknote/react";
import { BlockFallback, useBlockFallbackLabels } from "./units/e3-blocks";
import { LazyBlock } from "./units/e5-performance";

/**
 * The frame around every custom block's view (wave 2 step 0).
 *
 * An error inside one block shows that block's fallback (unit E3 owns how it
 * looks) instead of breaking the page, and a heavy block may wait until it is
 * near the screen before it renders (unit E5 owns when). Units do not edit
 * this file.
 */

interface FrameProps {
  /** The block type, e.g. "embed" or "query". */
  type: string;
  blockId: string;
  children: React.ReactNode;
}

export class BlockErrorBoundary extends React.Component<
  {
    type: string;
    blockId: string;
    children: React.ReactNode;
    fallback: (retry: () => void) => React.ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Reported, not swallowed: the rest of the page keeps working.
    console.error(
      `Block ${this.props.type} (${this.props.blockId}) failed to render`,
      error,
    );
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed
      ? this.props.fallback(this.retry)
      : this.props.children;
  }
}

export function BlockFrame({ type, blockId, children }: FrameProps) {
  const labels = useBlockFallbackLabels();
  return (
    <BlockErrorBoundary
      type={type}
      blockId={blockId}
      fallback={(retry) => (
        <BlockFallback
          type={type}
          blockId={blockId}
          labels={labels}
          onRetry={retry}
        />
      )}
    >
      <LazyBlock type={type} blockId={blockId}>
        {children}
      </LazyBlock>
    </BlockErrorBoundary>
  );
}

/**
 * Wraps a block implementation's view in a BlockFrame. Typed by the call
 * site: `createReactBlockSpec(config, framed("embed", { render: ... }))`.
 */
export function framed<B extends BlockConfigOrCreator>(type: string, impl: ReactCustomBlockImplementation<B>): ReactCustomBlockImplementation<B> {
  // Rendered as a child component, so the frame's boundary catches its errors.
  const Inner = impl.render as unknown as React.ComponentType<object>;
  const Framed = (props: ReactCustomBlockRenderProps<B>) => (
    <BlockFrame type={type} blockId={props.block.id}>
      {React.createElement(Inner, props as object)}
    </BlockFrame>
  );
  return { ...impl, render: Framed };
}

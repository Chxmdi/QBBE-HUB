"use client";

import { Component, type ReactNode } from "react";

/**
 * Keeps one failed section of a record page from taking the page down: the
 * section shows its error line and every other section still renders.
 */
export class SectionBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

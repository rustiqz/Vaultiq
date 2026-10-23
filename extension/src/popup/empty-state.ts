// The screen for "there is nothing here": what is missing, why that is fine,
// and what to do next.
//
// One builder so every empty list in the popup looks like the same product.
// Text goes in as text, never as markup: what a title or hint says can include
// a search term the user typed.

import { el } from "./dom.js";
import { icon, type IconName } from "./icons.js";

export interface EmptyAction {
  label: string;
  onClick: () => void;
  /** The one thing most worth doing. At most one per screen. */
  primary?: boolean;
}

export interface EmptyStateOptions {
  icon: IconName;
  title: string;
  hint: string;
  actions?: EmptyAction[];
  /** For a list pane rather than a whole screen: smaller, nothing around it. */
  compact?: boolean;
}

export function emptyState(options: EmptyStateOptions): HTMLElement {
  const actions = (options.actions ?? []).map((action) => {
    const button = el("button", {
      className: action.primary === true ? "primary" : "",
      type: "button",
      textContent: action.label,
    });
    button.addEventListener("click", action.onClick);
    return button;
  });

  return el("section", { className: `empty-state${options.compact === true ? " compact" : ""}`, role: "status" }, [
    el("div", { className: "empty-art" }, [icon(options.icon, { size: options.compact === true ? 22 : 30 })]),
    el("h2", { className: "empty-title", textContent: options.title }),
    el("p", { className: "empty-hint muted", textContent: options.hint }),
    ...(actions.length > 0 ? [el("div", { className: "empty-actions" }, actions)] : []),
  ]);
}

// The one element helper the popup builds everything from.
//
// Lives on its own so panels can be split into their own files without each
// one growing a copy — a second `el` that drifted would be a quiet source of
// inconsistent markup.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

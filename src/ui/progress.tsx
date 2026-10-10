export function mountProgress(element: HTMLDivElement | null): void {
  if (!element) return;
  element.classList.add("gitbin-progress");
  element.setAttribute("role", "progressbar");
  element.replaceChildren();
  element.createDiv({ cls: "gitbin-progress-fill" });
}

export function Progress({ label }: { readonly label: string }) {
  return <div role="progressbar" ref={mountProgress} aria-label={label} />;
}

import { useCallback, type ComponentProps } from "react";
import { setTooltip } from "obsidian";
import { Button } from "./controls";

export function IconButton({
  label,
  ...props
}: ComponentProps<typeof Button> & { readonly label: string }) {
  const tooltip = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element) setTooltip(element, label);
    },
    [label],
  );
  return (
    <Button
      {...props}
      ref={tooltip}
      aria-label={label}
      className="clickable-icon gitbin-header-action"
    />
  );
}

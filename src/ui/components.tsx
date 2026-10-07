import * as Label from "@radix-ui/react-label";
import { Primitive } from "@radix-ui/react-primitive";
import { useId, type ReactNode } from "react";

export function TextField({
  label,
  hint,
  value,
  disabled,
  onChange,
  placeholder = "",
  type = "text",
}: {
  readonly label: string;
  readonly hint: ReactNode;
  readonly value: string;
  readonly disabled: boolean;
  readonly placeholder?: string;
  readonly type?: "text" | "url" | "password" | "email";
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="setting-item gitbin-field">
      <div className="setting-item-info">
        <Label.Root htmlFor={id} className="setting-item-name">
          {label}
        </Label.Root>
        <div id={id + "-hint"} className="setting-item-description">
          {hint}
        </div>
      </div>
      <div className="setting-item-control">
        <Primitive.input
          id={id}
          type={type}
          className="gitbin-text-input"
          name={label.toLowerCase().replaceAll(" ", "-")}
          aria-describedby={id + "-hint"}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={type === "password" ? "new-password" : "off"}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

import { Notice, setIcon } from "obsidian";

export function warningNotice(message: string): void {
  const notice = new Notice("", 10000);
  notice.messageEl.addClass("gitbin-warning-notice");
  const icon = notice.messageEl.createSpan({ cls: "gitbin-warning-notice-icon" });
  icon.setAttribute("aria-hidden", "true");
  setIcon(icon, "triangle-alert");
  notice.messageEl.createSpan({ text: message });
}

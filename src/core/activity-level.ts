export function activityLevel(level: string): "info" | "warning" | "error" {
  //@ verify
  //@ ensures level === "Error" ==> \result === "error"
  //@ ensures level === "Warn" ==> \result === "warning"
  //@ ensures level !== "Error" && level !== "Warn" ==> \result === "info"
  return level === "Error" ? "error" : level === "Warn" ? "warning" : "info";
}

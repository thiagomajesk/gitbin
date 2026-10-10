import type { Config } from "../core/config";
import type { DeviceLimits } from "../core/selective-ports";

export function deviceLimits(config: Config): DeviceLimits {
  const mib = 1024 * 1024;
  const maximum =
    config.maxDownloadMegabytes === "unlimited" ? Infinity : config.maxDownloadMegabytes * mib;
  return {
    downloadBytes: maximum,
    storageBytes:
      config.downloadMode === "all" || config.storageMegabytes === "unlimited"
        ? "unlimited"
        : config.storageMegabytes * mib,
    mode: config.downloadMode,
  };
}

export type Outcome = "success" | "retry" | "stop";
export interface RetryHost {
  run(manual: boolean): Promise<Outcome>;
  online(): boolean;
  status(message: string): void;
  random(): number;
  interval(): number | null;
}
export const retryDelay = (attempt: number, random: number): number =>
  Math.min(60000, 2000 * 2 ** attempt * (0.8 + random * 0.4));
export function createRetryLoop(host: RetryHost) {
  let timer: number | undefined;
  let stopped = false;
  let busy = false;
  let attempt = 0;
  let manual = false;
  let queued = false;
  const cancel = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (delay: number) => {
    cancel();
    timer = window.setTimeout(() => {
      void run();
    }, delay);
  };
  const retry = () => {
    if (attempt >= 6) {
      host.status("Retries paused · Sync now to try again");
      return;
    }
    const delay = retryDelay(attempt++, host.random());
    host.status("Retry " + attempt + "/6 in " + Math.ceil(delay / 1000) + " seconds");
    schedule(delay);
  };
  const handle = (outcome: Outcome) => {
    if (outcome === "stop") return;
    if (outcome === "retry") {
      retry();
      return;
    }
    attempt = 0;
    manual = false;
    const delay = queued ? 0 : host.interval();
    queued = false;
    if (delay !== null) schedule(delay);
  };
  const available = () => !stopped && !busy;
  const finish = (outcome: Outcome) => {
    if (!stopped) handle(outcome);
    return outcome === "success";
  };
  const run = async (): Promise<boolean> => {
    if (!available()) return false;
    cancel();
    if (!host.online()) {
      host.status("Offline · Changes stay on this device");
      return false;
    }
    busy = true;
    try {
      const outcome = await host.run(manual);
      return finish(outcome);
    } finally {
      busy = false;
    }
  };
  return {
    start: () => {
      stopped = false;
      attempt = 0;
      manual = false;
      queued = false;
      cancel();
      if (host.interval() !== null) schedule(0);
    },
    request: () => {
      attempt = 0;
      manual = true;
      return run();
    },
    wake: () => {
      attempt = 0;
      if (busy && !stopped) {
        queued = true;
        return Promise.resolve(false);
      }
      return run();
    },
    stop: () => {
      stopped = true;
      queued = false;
      cancel();
    },
  };
}

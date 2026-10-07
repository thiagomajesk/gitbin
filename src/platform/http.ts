import type { NetworkPolicy } from "just-git";
import { requestUrl } from "obsidian";
async function withDeadline<A>(pending: Promise<A>): Promise<A> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("Repository request timed out after 30 seconds.")),
          30000,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}
export const obsidianFetch: NonNullable<NetworkPolicy["fetch"]> = async (input, init) => {
  const request = new Request(input, init);
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  const response = await withDeadline(
    requestUrl({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      ...(body ? { body } : {}),
      throw: false,
    }),
  );
  return new Response(response.arrayBuffer, { status: response.status, headers: response.headers });
};

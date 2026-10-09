/** Verify the server's advertised main before just-git creates its CAS update. */
export async function checkPushLease(response: Response, expected: string): Promise<void> {
  const text = await response.clone().text();
  const match = /([a-f0-9]{40}) refs\/heads\/main(?:\0|\n)/.exec(text);
  if (match?.[1] !== expected)
    throw new Error("Repository changed since preview. Preview consolidation again.");
}

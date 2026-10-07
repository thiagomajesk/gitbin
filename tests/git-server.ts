import { spawn, execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Buffer } from "node:buffer";

export async function gitServer(root: string) {
  execFileSync("git", ["-C", join(root, "remote.git"), "config", "uploadpack.allowFilter", "true"]);
  execFileSync("git", [
    "-C",
    join(root, "remote.git"),
    "config",
    "uploadpack.allowReachableSHA1InWant",
    "true",
  ]);
  const executable = join(
    execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
    process.platform === "win32" ? "git-http-backend.exe" : "git-http-backend",
  );
  const serve = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const child = spawn(executable, [], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? "GET",
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: String(body.length),
        REMOTE_USER: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.resume();
    child.on("error", () => {
      response.writeHead(500);
      response.end();
    });
    child.stdin.on("error", () => {
      if (response.writableEnded) return;
      response.writeHead(500);
      response.end();
    });
    child.on("close", () => {
      if (response.writableEnded) return;
      const raw = Buffer.concat(output);
      let separator = raw.indexOf("\r\n\r\n");
      let length = 4;
      if (separator < 0) {
        separator = raw.indexOf("\n\n");
        length = 2;
      }
      if (separator < 0) {
        response.writeHead(500);
        response.end(raw);
        return;
      }
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of raw.subarray(0, separator).toString().split(/\r?\n/)) {
        const colon = line.indexOf(":");
        const name = line.slice(0, colon).toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (name === "status") status = Number(value.split(" ")[0]);
        else headers[name] = value;
      }
      response.writeHead(status, headers);
      response.end(raw.subarray(separator + length));
    });
    child.stdin.end(body);
  };
  const server = createServer((request, response) => {
    void serve(request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address.");
  return {
    url: `http://127.0.0.1:${address.port}/remote.git`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

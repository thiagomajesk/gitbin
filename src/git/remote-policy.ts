export type RemoteAddress = {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  hash: string;
  search: string;
};
function localHttp(protocol: string, hostname: string): boolean {
  //@ verify
  //@ ensures \result === (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"))
  return (
    protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
  );
}
export function allowedRemote(url: RemoteAddress, whitespace: boolean): boolean {
  //@ verify
  //@ ensures \result === ((url.protocol === "https:" || localHttp(url.protocol, url.hostname)) && url.username === "" && url.password === "" && url.hash === "" && url.search === "" && !whitespace)
  return (
    (url.protocol === "https:" || localHttp(url.protocol, url.hostname)) &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    url.search === "" &&
    !whitespace
  );
}

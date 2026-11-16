import { headers } from "next/headers";
import { WebsiteContent } from "./website-content";
export { metadata } from "./website-content";

export default async function Website() {
  const host = (await headers()).get("host") ?? "";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  return <WebsiteContent local={local} />;
}

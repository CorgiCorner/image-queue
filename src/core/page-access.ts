import { headers } from "next/headers";
import { forbidden } from "next/navigation";
import { verifyAccess } from "./access";

export async function requirePageAccess() {
  const token = (await headers()).get("cf-access-jwt-assertion");
  try {
    await verifyAccess(token);
  } catch {
    forbidden();
  }
}

export async function runWithCloudflareRequestContext(_request: Request, _env: unknown, _ctx: unknown, work: () => Promise<unknown>) {
  return work();
}

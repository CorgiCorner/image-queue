export function platformSupport(platform: string, architecture: string) {
  const tested = platform === 'darwin' && architecture === 'arm64';
  return {tested, platform, architecture, warning: tested ? undefined : 'Untested on this platform. image-queue has been tested on macOS with Apple silicon only.'};
}

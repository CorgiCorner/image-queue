import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Build a separate, allowlisted app: no dashboard, API routes or user data.
const root = process.cwd();
const stage = path.join(root, 'work', 'website-build');
const basePath = process.env.WEBSITE_BASE_PATH ?? '/image-queue';
if (basePath && !/^\/[a-zA-Z0-9/_-]+$/.test(basePath)) throw new Error('Invalid WEBSITE_BASE_PATH');
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, 'src', 'app'), { recursive: true });
await cp('src/app/website', path.join(stage, 'src/app/website'), { recursive: true });
await rm(path.join(stage, 'src/app/website/page.tsx'));
const css = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../";');
await writeFile(path.join(stage, 'src/app/globals.css'), css);
for (const file of ['copy-button.tsx', 'ui/button.tsx', 'ui/tooltip.tsx']) {
  await mkdir(path.dirname(path.join(stage, 'src/components', file)), { recursive: true });
  await cp(path.join('src/components', file), path.join(stage, 'src/components', file));
}
await mkdir(path.join(stage, 'src/lib'), { recursive: true });
await cp('src/lib/utils.ts', path.join(stage, 'src/lib/utils.ts'));
await mkdir(path.join(stage, 'public'), { recursive: true });
await cp('public/showcase', path.join(stage, 'public/showcase'), { recursive: true });
for (const file of ['package.json', 'tsconfig.json', 'postcss.config.mjs']) await cp(file, path.join(stage, file));
// Resolve dependencies from the installed root without duplicating them.
const { symlink } = await import('node:fs/promises');
await symlink(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
await writeFile(path.join(stage, 'src/app/page.tsx'), 'import { WebsiteContent } from "./website/website-content";\nexport { metadata } from "./website/website-content";\nexport default function Page() { return <WebsiteContent homeHref="/" />; }\n');
await writeFile(path.join(stage, 'src/app/layout.tsx'), 'import "./globals.css";\nexport default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n');
await writeFile(path.join(stage, 'next.config.mjs'), `export default { output: 'export', trailingSlash: true, basePath: ${JSON.stringify(basePath)}, images: { unoptimized: true } };\n`);
// The shared components folder contains dashboard-only files; only imports of
// the public page participate in this app's TypeScript/build dependency graph.
const tsconfig = JSON.parse(await readFile(path.join(stage, 'tsconfig.json'), 'utf8'));
tsconfig.include = ['next-env.d.ts', 'src/app/**/*.tsx', '.next/types/**/*.ts'];
await writeFile(path.join(stage, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
  cwd: stage, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_WEBSITE_BASE_PATH: basePath },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const output = path.join(root, 'dist', 'website');
await mkdir(path.dirname(output), { recursive: true });
await rm(output, { recursive: true, force: true });
await cp(path.join(stage, 'out'), output, { recursive: true });
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Public website exported to dist/website (base path: ${basePath || '/'})`);

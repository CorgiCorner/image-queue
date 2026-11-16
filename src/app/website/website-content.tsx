import Link from "next/link";
import { Slideshow, ArrowUpRight, Folder, Stack, Terminal, Image as ImageIcon } from "@phosphor-icons/react/ssr";
import { ProductStage, VersionStudy } from "./product-stage";
import { SetupPrompt } from "./setup-prompt";
import { InstallCommands } from "./install-commands";
import "./website.css";

const repository = "https://github.com/corgicorner/image-queue";
const docs = `${repository}#connect-your-coding-agent-mcp`;
export const metadata = {
  title: "image-queue: an image studio for your ChatGPT plan",
  description: "Queue your image ideas with the ChatGPT plan you already pay for. Keep images, prompts and versions in folders on your Mac. Open source, with an optional OpenAI API key.",
};

export function WebsiteContent({ local = false, homeHref = "/website" }: { local?: boolean; homeHref?: string }) {
  const primaryHref = local ? "/" : "#install";
  const primaryLabel = local ? "Open dashboard" : "Get image-queue";
  return (
    <main className="public-site">
      <nav className="site-nav" aria-label="Main navigation">
        <Link className="site-logo" href={homeHref}><Slideshow size={23} /> image-queue</Link>
        <div>
          <a href="#workflow">How it works</a>
          <a href="#sources">Two ways to generate</a>
          <a href="#install">Install</a>
          <a href={repository}>GitHub</a>
          <Link className="site-button small" href={primaryHref}>{primaryLabel}<ArrowUpRight size={16} /></Link>
        </div>
      </nav>
      <section className="site-hero">
        <div>
          <p className="site-intro">Open source · On your Mac · Your images</p>
          <h1>An image studio for your ChatGPT plan.</h1>
          <p className="site-description">Line up your ideas and image-queue works through them with the plan you already pay for. Every image is saved to a folder on your Mac, with its prompt and earlier versions.</p>
          <div className="site-hero-actions">
            <Link className="site-button" href={primaryHref}>{primaryLabel}<ArrowUpRight size={18} /></Link>
            <a href="#workflow">See how it works</a>
          </div>
        </div>
        <div className="site-art"><ProductStage /></div>
      </section>
      <section className="site-workflow" id="workflow">
        <div className="site-section-heading"><h2>Describe it. Make it. Keep it.</h2></div>
        <div className="site-features">
          <article><ImageIcon /><h3>1. Describe.</h3><p>Describe your image and add a reference if you have one. Line up a few ideas at once.</p></article>
          <article><Stack /><h3>2. Wait.</h3><p>image-queue works through your ideas while you do something else. See what’s waiting and what’s ready.</p></article>
          <article><Folder /><h3>3. Keep.</h3><p>Find every image in its project folder, alongside its prompt. Try another version without losing the first.</p></article>
        </div>
      </section>
      <section className="site-sources" id="sources">
        <div><h2>Use the plan you already pay for, or your own key.</h2></div>
        <div className="source-list">
          <article><Terminal /><div><h3>Your ChatGPT plan</h3><p>No extra generation charge, within your plan limits. Use a ChatGPT plan that includes Codex. Your existing limits still apply.</p></div></article>
          <article><ImageIcon /><div><h3>Your OpenAI API key</h3><p>Keep going when your plan limit runs out. Add your own OpenAI API key and choose a model. API generation is billed separately; switching sources is your choice.</p></div></article>
        </div>
      </section>
      <section className="site-benefits" aria-labelledby="benefits-heading">
        <div className="site-section-heading"><h2 id="benefits-heading">A home for every image you make.</h2></div>
        <div className="benefits-layout"><VersionStudy /><ul>
          <li><strong>A local gallery.</strong> Three layouts, projects, tags and search.</li>
          <li><strong>Versions and references.</strong> Iterate on an image without losing the earlier ones.</li>
          <li><strong>Plain files.</strong> Images and prompts live in your own project folders.</li>
          <li><strong>Private by default.</strong> Only the prompt and the references you attach are sent to the provider.</li>
        </ul></div>
      </section>
      <section className="site-setup" id="install" aria-labelledby="setup-heading">
        <div className="site-section-heading"><h2 id="setup-heading">A little help getting started.</h2><p>Let ChatGPT guide the setup on your Mac. You’ll review and approve the steps along the way.</p></div>
        <SetupPrompt />
        <details className="terminal-option"><summary>Prefer the terminal?</summary><div className="terminal-option-content"><p>You’ll need git, Node.js 24+, pnpm 10.28.2 and the Codex CLI for plan-based generation. Tested on macOS (Apple silicon).</p><InstallCommands /><p>Open <code>http://127.0.0.1:3215</code>, then choose your source in Settings. Keep image-queue running while it works.</p></div></details>
      </section>
      <section className="site-faq" aria-labelledby="faq-heading">
        <div className="site-section-heading"><h2 id="faq-heading">FAQ</h2></div>
        <dl>
          <div><dt>Do I need an API key?</dt><dd>No, if your ChatGPT plan includes Codex. Sign in with that account during setup. Availability depends on your plan and workspace permissions. An OpenAI API key is an optional, separately billed source.</dd></div>
          <div><dt>Is it free?</dt><dd>image-queue is free and open source under Apache 2.0. Generating through your ChatGPT plan uses its existing limits, with no extra generation charge. It does not increase those limits. Using an API key is billed separately.</dd></div>
          <div><dt>Where are my images?</dt><dd>In your project folders, as ordinary files. Nothing is uploaded except the prompt and references sent to the provider.</dd></div>
          <div><dt>Do I need technical experience?</dt><dd>Setup still installs local tools. ChatGPT can guide you, but you may need to approve installations and sign in yourself. The guided setup has not yet been validated on a clean Mac.</dd></div>
        </dl>
      </section>
      <section className="site-agents" aria-labelledby="agents-heading"><div><h2 id="agents-heading">Works with your coding agent too.</h2><p>Connect an MCP-compatible agent to request images, check progress and retrieve results from the same workspace.</p></div><a className="site-button" href={docs}>Connect your agent <ArrowUpRight size={18} /></a></section>
      <footer className="site-footer">
        <Link className="site-logo" href={homeHref}><Slideshow size={18} /> image-queue</Link>
        <span>An independent project. Not affiliated with OpenAI.</span>
        <div className="site-footer-links"><a href={repository}>GitHub</a><a href={`${repository}#readme`}>Docs</a><a href={`${repository}/blob/main/LICENSE`}>Apache 2.0</a></div>
      </footer>
    </main>
  );
}

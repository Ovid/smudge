# Smudge — Monetization Strategy

**Version:** 1.0
**Date:** 2026-03-29
**Author:** Ovid / Claude (collaborative)
**Companion to:** Smudge MVP PRD v0.3.0, Feature Roadmap v0.4.0, Strategic Recommendations

---

## Guiding Principles

Smudge's monetization must respect the following non-negotiable commitments:

1. **The software is free and MIT-licensed.** The source code is open. Anyone can build, modify, and distribute Smudge. This cannot be revoked or undermined by monetization choices.
2. **No feature gates.** Every feature available in the paid Electron version is also available in the self-hosted Docker version. No writer is ever locked out of a capability because they can't afford to pay.
3. **No subscriptions for the software itself.** Writers are subscription-hostile (see competitive analysis). Smudge will never charge a recurring fee for access to the application.
4. **Data ownership is sacred.** The writer's manuscripts live on their machine. No monetization model should create incentives to move data to a cloud the writer doesn't control — except when the writer explicitly *chooses* hosted convenience.
5. **Monetization should feel like patronage, not extraction.** Writers who pay should feel they're supporting something they believe in, not being squeezed for access to their own work.

### Revenue Reality Check

Voluntary payment models for desktop software typically see 1–3% conversion rates. If 10,000 people download the Electron version, perhaps 150–300 will pay anything. This is normal and acceptable for a passion project, but insufficient to fund sustained full-time development.

The strategy below is designed in layers: the baseline (voluntary payments) generates modest income while building an audience. The middle layer (services and products) generates real revenue from that audience. The long-term layer (platform and ecosystem) scales if Smudge achieves significant adoption.

No single layer is expected to be sufficient alone. The strategy works as a portfolio.

---

## Layer 1: Baseline — Voluntary Payments

### 1.1 Pay-What-You-Can Electron Downloads

**What:** The Electron version of Smudge is downloadable from a website. The download page includes a "Pay what you can afford" widget (not a paywall — the download is always accessible regardless of payment). Suggested amounts: $0 / $10 / $25 / $50 / custom.

**Implementation:**
- A simple landing page (could be a static site on GitHub Pages or a lightweight site on a custom domain).
- Payment processing via Stripe, Gumroad, or LemonSqueezy. Gumroad and LemonSqueezy both support "pay what you want" natively and handle hosting/distribution of the download file.
- The page should emphasize: "Smudge is free. If you can afford to pay, your contribution funds continued development. If you can't, download it anyway — you're welcome here."

**Tone matters.** The payment prompt should never guilt-trip. Writers who download for free are not freeloaders — they're users who may contribute in other ways (bug reports, word of mouth, community participation, future payments when their circumstances change). The message should make paying feel good, not make *not* paying feel bad.

**Expected revenue:** Low. At 1–3% conversion and a modest average payment ($15–$20), this generates perhaps $150–$600 per 10,000 downloads. This is supplementary income, not a business model. Its primary value is establishing the *habit* of voluntary payment and creating a direct relationship with users who care enough to pay.

### 1.2 In-App Donate Button

**What:** The Electron version includes a small, unobtrusive "Support Smudge" button in the application — perhaps in the settings panel or the about screen. Clicking it opens the donation page in the user's browser.

**Design constraints:**
- The button must be present but never intrusive. It should not appear in the writing area, the sidebar, or any location that interrupts the writing flow. The settings panel or a dedicated "About Smudge" page is appropriate.
- No pop-ups, no periodic reminders, no "you've been using Smudge for 30 days — consider donating!" nags. Writers specifically hate this pattern (see competitive analysis: one writer rated a tool down because of a "permanent upgrade prompt" in the sidebar).
- The button should feel like a "tip jar at a café," not a "donation box at a hospital."

**Expected revenue:** Very low as a standalone channel. Its value is in *persistence* — it's always there, so when a writer finishes their book and feels grateful, the path to expressing that gratitude is one click away.

### 1.3 GitHub Sponsors / Open Collective

**What:** Set up a GitHub Sponsors profile and/or an Open Collective page for Smudge. These platforms allow recurring and one-time contributions, and they provide visibility in the open-source community.

**Why both channels:** GitHub Sponsors reaches developers and technical users who discover Smudge through the repository. Open Collective reaches a broader audience and provides transparent financial reporting (every dollar in and out is visible), which builds trust with supporters.

**Tiers (suggested):**
- **Reader** ($3/month): Name in the project's supporters list. Access to a sponsors-only Discord channel for early feature previews and discussion.
- **Writer** ($10/month): Above, plus a vote in quarterly feature prioritization polls.
- **Patron** ($25/month): Above, plus a "Supported by" credit in the application's About page.
- **Publisher** ($100/month): For organizations. Logo in the project README and website. Direct access to discuss feature needs.

**Expected revenue:** Depends entirely on community size and engagement. A project with 1,000+ active users might generate $500–$2,000/month from sponsorships. This takes time to build.

---

## Layer 2: Products and Services

### 2.1 Hosted Smudge (Smudge Cloud)

**What:** A managed, hosted version of Smudge for writers who can't or won't run Docker or install Electron. Identical software, but Smudge handles the server, backups, uptime, and updates. The writer signs up, gets a personal Smudge instance, and writes in their browser.

**Pricing:** $5–$8/month, or $50–$75/year. This is positioned as a *convenience fee*, not a software fee. The messaging is explicit: "Smudge is free. If you can run it yourself, do. If you'd rather we handle the infrastructure, we'll keep your manuscripts safe for the price of a coffee each month."

**How it works:**
- Each user gets an isolated Smudge instance (could be a container per user on a shared server, or a lightweight multi-tenant setup if the architecture evolves to support it).
- Daily automated backups of the user's SQLite database.
- The user can export their entire database at any time (data portability is non-negotiable).
- The user can migrate to self-hosting at any point by downloading their SQLite file and running it in Docker or Electron.

**Target audience:** Non-technical writers who want Smudge but will never touch a terminal. This is the audience that the Electron version serves partially, but some writers prefer web-based tools they can access from any device without installing anything.

**Economics:** A small VPS ($20–$40/month) can host dozens of Smudge instances (it's a single-user SQLite app with minimal resource requirements). At $5/month per user, 10 paying users cover the infrastructure cost. 50 users generate meaningful revenue. This is a high-margin service with low operational overhead.

**Risk:** You become responsible for other people's manuscripts. This is a serious obligation. Backup procedures, security, and uptime guarantees must be robust before offering this. Start with a small beta group, not a public launch.

**Timeline:** This can launch whenever the Docker version is stable and you're confident in the backup/restore workflow. It doesn't require any code changes — it's an operational offering around the existing product.

### 2.2 Premium Export Templates

**What:** A collection of professionally designed export templates sold as a one-time purchase. The free version of Smudge ships with clean, functional templates. The premium pack offers more variety, more polish, and format-specific optimizations.

**What's in the pack:**
- 10–15 book interior designs for fiction (genre-appropriate: literary, thriller, romance, sci-fi/fantasy, literary fiction, children's/YA) with proper front matter, chapter openings, scene breaks, headers/footers, and typography.
- 5–8 non-fiction interior designs (academic, popular non-fiction, memoir, business/self-help) with footnote/endnote styles, block quote treatments, and bibliography formatting.
- Manuscript submission format (industry-standard double-spaced, Times New Roman, headers with title/author/page number — what agents and publishers expect).
- KDP-optimized templates with trim sizes pre-configured for Amazon's print-on-demand requirements.
- IngramSpark-optimized templates.
- EPUB templates tested across major e-readers (Kindle, Apple Books, Kobo, Nook).

**Pricing:** $15–$25 for the full pack. One-time purchase. Updates included.

**Why writers pay for this:** Atticus charges $147 and Vellum charges $250 largely on the strength of their formatting capabilities. Self-publishing writers care deeply about professional book interiors. A $20 template pack that makes their Smudge-exported book look like it came from a traditional publisher is a trivial expense compared to the alternatives.

**Implementation:** Templates are configuration files (CSS for HTML/EPUB, style definitions for DOCX, layout specifications for PDF). They plug into the Phase 3 export pipeline. The free templates and premium templates use the same extension mechanism — premium ones just have more sophisticated typography and design.

**Distribution:** Sold through the Smudge website (Gumroad or LemonSqueezy). Delivered as a downloadable file the writer drops into their Smudge installation. For hosted Smudge users, premium templates are available in-app.

**Expected revenue:** Moderate. If 5% of Smudge users self-publish (a reasonable assumption — many writers do), and 10% of those buy the template pack at $20, that's $100 per 1,000 users. Small per-unit but high margin and zero ongoing cost after creation.

### 2.3 Consulting and Custom Deployments

**What:** Professional services for organizations that want to use Smudge internally. This includes: deploying Smudge on internal infrastructure, customizing the tool for organizational workflows (custom templates, house style enforcement, branded themes, custom export formats), training writers and editors, and ongoing support contracts.

**Target clients:**
- **Publishing houses** that want a standardized writing environment for their authors.
- **Content agencies** that manage teams of writers producing long-form content.
- **University writing programs** that need a teaching tool for creative writing or academic writing courses.
- **Corporate communications teams** that produce reports, white papers, or policy documents.
- **Non-profit organizations** that produce research reports or advocacy publications.

**Pricing model:** Project-based or retainer. Typical engagements might range from $2,000 (basic deployment + training) to $10,000+ (custom development + ongoing support). These numbers depend on the client and the scope, but institutional budgets can accommodate this easily — a university department or publishing house routinely spends this on software tooling.

**Why this works:** The software is free, but configuring it for an organization's specific needs requires expertise. This is the Red Hat model: the code is open, the expertise is the product. You're not selling Smudge — you're selling the knowledge of how to make Smudge work for a specific context.

**How this leverages Leïla:** Your existing consultancy can offer Smudge deployment as a service line. Leïla can lead client relationships while you handle technical customization. This fits naturally into the consulting work you're already doing.

**Expected revenue:** High per-engagement but low volume. One or two consulting engagements per quarter at $3,000–$5,000 each would be significant income relative to the other channels. This requires active business development — clients won't find you passively.

**Timeline:** This becomes viable when Smudge is stable enough to deploy for others (post-MVP, probably after Phase 3 when export is functional). It doesn't require any product changes — it's a service wrapped around the existing product.

### 2.4 Workshops and Writing Courses

**What:** Paid workshops — online or in-person — on topics that sit at the intersection of writing craft and tool mastery. These are not "how to use Smudge" tutorials (those should be free documentation). They're substantive writing instruction that happens to use Smudge as the tool.

**Workshop concepts:**
- **"Managing 80,000 Words: Organizing a Book-Length Project"** — How to structure a long manuscript, manage research, track consistency, and maintain momentum. Uses Smudge as the demonstration tool, but the principles apply universally.
- **"The Research-Driven Book: From Sources to Manuscript"** — For non-fiction writers. How to organize research, link claims to sources, maintain factual accuracy, and structure an argument. Uses Smudge's Phase 6 features as the practical environment.
- **"From Draft to Published: The Self-Publishing Workflow"** — End-to-end: drafting, revision, formatting, export, and upload to KDP/IngramSpark. Uses Smudge for the entire pipeline.
- **"Building a Writing Habit: Goals, Tracking, and the Psychology of Consistency"** — Uses Smudge's Phase 2 velocity tracking as a framework for discussing the habits that produce books.

**Pricing:** $50–$150 per participant for a 2–3 hour online workshop. $200–$500 for a half-day in-person workshop at a writing conference.

**Why writers pay for this:** Novlr and Reedsy both offer writing instruction as part of their platform strategy. Reedsy's courses are a significant driver of platform engagement. The difference here is that your workshops come from a builder-writer — someone who has thought deeply about the writing process *and* built a tool embodying those thoughts. That dual perspective is unusual and valuable.

**Expected revenue:** Moderate. A quarterly online workshop with 20–50 participants at $75 each generates $1,500–$3,750. In-person workshops at conferences generate less per event but provide visibility and networking.

**Synergy with the Smudge book (§2.5):** Workshops and the book feed each other. The book provides the curriculum; the workshops provide the interactive experience. Each promotes the other.

### 2.5 The Smudge Book

**What:** A non-fiction book about the craft of managing a long-form writing project. Working title: *The Architecture of a Book: How to Manage 80,000 Words Without Losing Your Mind.* Written in Smudge. Exported with Smudge. Published using the self-publishing workflow that Smudge supports.

**The book's thesis:** Writing a book is a project management problem that most writers solve with intuition, anxiety, and caffeine. It doesn't have to be. There are concrete methods for organizing research, structuring arguments, tracking consistency, maintaining momentum, and turning a messy draft into a finished manuscript — and they're informed by the same principles that make software projects succeed (or fail).

**Why this works as monetization:**
- **Direct revenue:** Self-published books generate ongoing royalty income. A well-positioned book in the "writing craft" category on Amazon can sell steadily for years.
- **Credibility:** A published book is the ultimate authority signal. It positions you as a thought leader in the writing-tool space.
- **Marketing for Smudge:** Every chapter naturally references how Smudge handles the problem being discussed. The book is a 200-page case study for the tool, but written as genuine writing instruction, not a product manual.
- **Dogfooding:** Writing the book *in* Smudge is the ultimate test of the tool. Every pain point you encounter becomes a feature improvement. Every smooth workflow becomes a selling point.

**The meta-narrative:** "I built a tool to write books, then wrote a book about writing books using the tool I built." This is inherently interesting and marketable. It's the *Getting Real* model (Basecamp wrote a book about their philosophy, which sold their software) applied to writing.

**Pricing:** $9.99–$14.99 for the ebook. $19.99–$24.99 for print. Standard self-publishing pricing.

**Timeline:** This should be written *while* building Smudge Phases 1–3. The development experience informs the book's content. The book should be ready to publish around the time the Electron version launches — so that the book and the tool promote each other simultaneously.

**Expected revenue:** A niche writing-craft book might sell 500–2,000 copies in its first year. At $10 per ebook with ~70% royalty, that's $3,500–$14,000. Not life-changing, but meaningful as part of the portfolio — and the long tail of book sales can continue for years.

---

## Layer 3: Platform and Ecosystem (Long-Term)

### 3.1 Sponsor-a-Feature / Bounty Board

**What:** Publish Smudge's roadmap publicly (the feature roadmap document essentially exists already). Allow writers, organizations, or writing-adjacent companies to sponsor specific features. Each feature has a funding goal and a list of backers.

**How it works:**
- The roadmap is displayed on the Smudge website with estimated development time and a funding target for each feature.
- Writers can pledge toward a feature. When the funding goal is met (or when you decide to build it regardless), development begins.
- All funded features become free for everyone — no one who pays gets exclusive access. This is the open-source bounty model.
- Backers get recognition: their name in the feature's release notes and in the application's credits.

**Examples:**
- "Phase 5c: Timeline View — $3,000 to fund. 22 backers so far. $1,850 raised."
- "Phase 7: Text-to-Speech — $1,000 to fund. 8 backers. $420 raised."
- A writing conference sponsors Phase 6a (Research & Citations) for $5,000 in exchange for logo placement on the feature's documentation and a keynote slot at their next event.

**Psychology:** This works because writers who want a specific feature feel *ownership* over it. They're not paying for software — they're funding the thing they want to exist in the world. This aligns with the patronage ethos and creates a community investment dynamic.

**Platforms:** Open Collective (transparent finances, good for open-source projects), GitHub Sponsors (reaches developers), or a simple custom page with Stripe payment links.

**Expected revenue:** Unpredictable but potentially significant for high-demand features. A single organizational sponsor could fund an entire phase. Individual contributions will be small ($10–$50) but meaningful in aggregate.

**Timeline:** This becomes viable once Smudge has visible traction — at least a few hundred active users — and a public roadmap that people can browse. Too early and there's no audience. Too late and the features are already built.

### 3.2 Plugin / Extension Marketplace

**What:** Once Smudge has a stable extension API (via TipTap's ProseMirror extension system), open it to third-party developers. A writer or developer who builds a specialized plugin can distribute it through a Smudge marketplace — free or paid.

**Potential plugins:**
- Screenplay formatting mode (industry-standard script layout)
- Poetry mode (line-based editing, stanza management, meter analysis)
- Translation side-by-side view (original and translation in parallel panes)
- Genre-specific world-building templates (fantasy magic systems, sci-fi tech trees, mystery evidence boards)
- Academic citation formats (Chicago, MLA, APA — more precise than Smudge's built-in simplified format)
- Dictation integration (speech-to-text directly into the editor)
- AI writing assistant integration (Claude, GPT — not built-in, but as an optional plugin the writer chooses to install)
- Custom analytics (readability scores, reading level, genre-specific metrics)
- Publisher-specific export profiles (formatting pre-configured for specific publishers' submission guidelines)

**Revenue model:** Smudge takes a 15–20% commission on paid plugin sales. Free plugins are listed without commission. This is the VS Code / Obsidian / Shopify model.

**Why this works long-term:** You can't build every feature every writer wants. A marketplace lets the community build for itself while generating revenue for the platform. The most popular plugins indicate where Smudge's core feature set should expand next.

**Prerequisites:** This requires a stable, well-documented extension API, a critical mass of users (probably 5,000+), and a review/quality process to prevent malicious or broken plugins. This is a Phase 7+ initiative at earliest.

**Expected revenue:** Highly dependent on adoption. With a healthy marketplace of 50+ plugins and 10,000+ users, this could generate $500–$2,000/month in commission. With 100,000+ users (if Smudge achieves broad adoption), significantly more.

### 3.3 "Built with Smudge" Author Credits

**What:** Offer a small, optional "Written with Smudge" badge and colophon text that authors can include in their published books. Provide a polished SVG badge, a suggested colophon line ("This book was written, organized, and exported using Smudge — a free, open-source writing tool. smudge.dev"), and instructions for including it in various formats (print, ebook, web).

**Why this matters:** Authors who love their tools *want* to talk about them. Scrivener benefits enormously from authors mentioning it in acknowledgements, blog posts, and interviews. Every published book that credits Smudge is organic marketing to the exact audience that might use it — other writers.

**Revenue:** Zero direct revenue. This is pure brand-building. Its value is measured in awareness, not dollars.

**Implementation:** Near-zero effort. Create the badge, write the colophon text, add it to the Smudge documentation. Optionally include a "Generate colophon" option in the export dialog.

**When to implement:** As soon as Phase 3 (Export) ships. The colophon is a natural addition to the export configuration dialog.

---

## Revenue Projection Scenarios

These are rough estimates, not forecasts. They're meant to illustrate how the layers combine, not predict specific outcomes.

### Scenario A: Passion Project (1,000 active users, minimal effort on monetization)

| Source | Monthly Revenue |
|--------|----------------|
| Pay-what-you-can downloads | $50–$100 |
| In-app donations | $20–$50 |
| GitHub Sponsors | $50–$100 |
| **Total** | **$120–$250/month** |

This covers hosting costs and a nice dinner each month. It does not fund development time.

### Scenario B: Active Side Project (5,000 active users, moderate effort)

| Source | Monthly Revenue |
|--------|----------------|
| Pay-what-you-can downloads | $200–$400 |
| Hosted Smudge (50 subscribers at $6/month) | $300 |
| Premium templates (ongoing sales) | $100–$200 |
| GitHub Sponsors / Open Collective | $200–$400 |
| Consulting (1 engagement/quarter, amortized) | $500–$1,000 |
| Workshops (1/quarter, amortized) | $250–$500 |
| **Total** | **$1,550–$2,800/month** |

This is meaningful supplementary income. Combined with consulting revenue, it could approach a modest part-time salary.

### Scenario C: Established Product (20,000+ active users, full monetization portfolio)

| Source | Monthly Revenue |
|--------|----------------|
| Pay-what-you-can downloads | $500–$1,000 |
| Hosted Smudge (200 subscribers at $6/month) | $1,200 |
| Premium templates (ongoing sales) | $300–$500 |
| GitHub Sponsors / Open Collective | $500–$1,000 |
| Consulting (2 engagements/quarter, amortized) | $1,500–$2,500 |
| Workshops (monthly) | $500–$1,000 |
| Book royalties (ongoing) | $300–$500 |
| Feature sponsorships | $200–$500 |
| Plugin marketplace commission | $200–$500 |
| **Total** | **$5,200–$8,500/month** |

This is a viable indie software business. It requires significant effort across multiple channels, but no single channel needs to carry the weight alone.

---

## Implementation Timeline

### Immediate (with MVP launch)

- Set up pay-what-you-can download page (Gumroad or LemonSqueezy)
- Create GitHub Sponsors profile
- Add in-app donate button to Electron version (settings/about screen)
- Begin writing *The Architecture of a Book* alongside Smudge development

### With Phase 3 (Export)

- Create and sell premium export template pack
- Add "Built with Smudge" colophon option to export dialog
- Begin offering workshops (online, small scale)

### With Electron Launch

- Launch hosted Smudge (small beta group first)
- Open Collective for transparent community funding
- Sponsor-a-feature board on the website
- Publish *The Architecture of a Book*

### With Significant Adoption (5,000+ users)

- Begin consulting/custom deployment outreach
- Scale workshops (writing conferences, partnerships with writing communities)
- Evaluate plugin marketplace feasibility

---

## What This Strategy Is Not

This strategy deliberately avoids:

- **Freemium with feature gates.** No writer should ever click a button and be told "upgrade to access this feature." Every feature is free. This is foundational to Smudge's identity and its competitive positioning against subscription-based tools.
- **Advertising.** No ads in the application. No sponsored content. No tracking. The writing environment is sacred.
- **Selling user data.** Smudge doesn't collect data. Even hosted Smudge should collect the minimum necessary for the service to function (authentication, billing), nothing more.
- **AI-as-a-service upsell.** While AI plugins could exist in a future marketplace, Smudge will not build a proprietary AI writing assistant and charge for it. This is an ideological line: Smudge helps writers write, it doesn't write for them.
- **Artificial scarcity.** The MIT license means anyone can fork Smudge, host it, and charge for it. This is a feature, not a bug. If someone creates a better version, writers win. The monetization strategy must be robust enough to survive competition — which means it must be built on trust, community, and service quality, not on controlling access to code.

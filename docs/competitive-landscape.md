# Smudge — Competitive Landscape

**Date:** 2026-03-29
**Author:** Ovid / Claude (collaborative)
**Purpose:** Understand who Smudge competes with, how popular and well-regarded each competitor is, and where Smudge fits in the market.

---

## Market Context

The writing enhancement software market was projected at $0.74 billion in 2024, growing at ~13% annually. This includes grammar checkers, AI writing assistants, and dedicated writing tools — a broad category that overstates the size of the book-writing tool niche. The relevant sub-market (long-form writing tools for authors) is much smaller, dominated by a handful of players.

The market is fragmented. No single tool commands majority share. Writers routinely use 2–5 tools in combination, which means Smudge isn't just competing against individual tools — it's competing against the *combined workflow* of Scrivener + Zotero + Google Docs + Atticus (or similar stacks).

---

## Competitor Profiles

### Scrivener

**The incumbent. The tool everyone else is compared against.**

| Attribute | Detail |
|-----------|--------|
| Developer | Literature & Latte (UK, small team, founded by Keith Blount) |
| First released | 2007 (Mac), 2011 (Windows), 2016 (iOS) |
| Pricing | $49 Mac/Windows (one-time), $23.99 iOS. Bundle discount for both platforms. |
| Platforms | macOS, Windows, iOS. No Android. No web. No Linux (abandoned beta exists). |
| User base | "Hundreds of thousands of users" and "millions of downloads" per Literature & Latte's own marketing. Exact figures not published. |

**Popularity:** Scrivener is the most-mentioned writing tool in every survey, comparison article, and forum thread I found. In a 2025 poll across LinkedIn writing communities, more than three-quarters of respondents named Scrivener as their preferred tool. On Facebook writing groups, more writers chose "Other" (then named Word, Google Docs, or Obsidian) — but Scrivener was still the single most-named dedicated writing tool. It dominates the "serious writer" segment.

**Public sentiment:** Deeply polarized. Writers who love Scrivener are *fiercely* loyal — "you can pry it from my cold dead fingers" is a representative quote. Writers who struggle with it are equally vocal. The most consistent themes:

- *Positive:* "Everything in one place." The Binder, the corkboard, the split screen, the ability to keep research alongside the manuscript. The one-time purchase price generates genuine goodwill. Snapshots (version history) are beloved. Writers who have invested the time to learn it describe it as indispensable.
- *Negative:* The learning curve is universally described as steep — "a cliff, not a slope." The Compile (export) function is powerful but confusing. The UI feels dated. Sync is clunky (Dropbox-dependent, no native cloud). The Windows version has historically been a second-class citizen. No web version means no writing from a Chromebook, shared computer, or device without the app installed. One writer described the experience as "I spent two weekends watching tutorials just to figure out the Compile function."

**What it does well for non-fiction:** Stores research materials (PDFs, web pages, images) alongside the manuscript. Split-screen view for referencing sources while writing. Footnotes and endnotes are supported. Can connect to citation managers (Zotero, EndNote) through documented but fragile workflows. The Binder organizes everything hierarchically.

**What it doesn't do for non-fiction:** Citations are just text — no semantic link between a footnote and a source record. No integrated research library with tagging, filtering, or status tracking. No fact-check status annotations. No argument structure visualization. The Zotero integration requires a multi-step workflow involving compiling to MultiMarkdown, running through a converter, opening in Word, and refreshing citations — described by users as "super cumbersome." Non-fiction writers use Scrivener for organization and drafting, then export to Word and Zotero for citations.

**Smudge positioning vs. Scrivener:** Smudge cannot out-feature Scrivener on day one — Scrivener has 19 years of development. The differentiators are: free/open source with no subscription, web-based (accessible anywhere), modern UI, integrated non-fiction research tools (Phase 6a), and a dramatically lower learning curve. The risk is that Scrivener's depth makes Smudge feel shallow by comparison, especially for fiction writers. The opportunity is that Scrivener's weaknesses (learning curve, dated UI, no web version, fragile citation workflows) are exactly what Smudge addresses.

---

### Microsoft Word

**The default. Not designed for books, but what most writers actually use.**

| Attribute | Detail |
|-----------|--------|
| Developer | Microsoft |
| Pricing | Microsoft 365 subscription ($6.99/month or $69.99/year), or one-time purchase of standalone version |
| Platforms | Windows, macOS, iOS, Android, web |
| User base | Over 1 billion Microsoft Office users globally (not all writers, obviously) |

**Popularity:** Word is the most widely *used* tool for writing, but not the most *chosen* — writers end up in Word because it's already there, because their publisher requires .docx, or because they've used it for 20 years. It's the baseline, not the aspiration.

**Public sentiment:** Resigned acceptance. Writers describe Word as "familiar," "comfortable," "like a pair of warm socks." They also describe it as "clunky," "crashing," "frustrating for long documents," and "not built for books." The core complaints: no chapter-level organization (one long document or many scattered files), formatting corruption in large documents, and the need for separate tools for everything except typing words.

**Smudge positioning vs. Word:** Smudge competes with Word on the question "should I use a tool designed for books, or a general-purpose word processor?" The answer depends on the writer's tolerance for new tools. Smudge's advantage: chapter-based organization, integrated preview, word count goals, export — all in one place. Word's advantage: universality, publisher familiarity, track changes, and zero learning curve.

---

### Google Docs

**The collaboration tool that writers use for lack of a better option.**

| Attribute | Detail |
|-----------|--------|
| Developer | Google |
| Pricing | Free with a Google account |
| Platforms | Web, iOS, Android |
| User base | Over 1 billion Google Workspace users |

**Popularity:** Extremely popular as a *supplement* to other tools. Writers use Google Docs for collaborating with editors and beta readers, then move to another tool for actual book writing. Relatively few writers use Google Docs as their primary book-writing tool — it gets slow with large documents and has no chapter-level organization.

**Public sentiment:** Appreciated for collaboration and accessibility. Criticized for falling apart with long documents ("it starts to run slow"), lack of book-specific features, and the difficulty of formatting for publication. The sentiment is essentially "it's fine for writing articles, but it wasn't built for books."

**Smudge positioning vs. Google Docs:** This is where Smudge has the most direct pitch: "Google Docs but designed for books." Chapter organization, preview mode, word count goals, and export are all things Google Docs doesn't do. The challenge: Google Docs' real-time collaboration is a killer feature that Smudge doesn't offer (and shouldn't, for MVP). Writers who need collaboration will continue to use Google Docs for that specific step in their workflow.

---

### Atticus

**The indie publisher's formatting tool.**

| Attribute | Detail |
|-----------|--------|
| Developer | Dave Chesson (Kindlepreneur) |
| First released | 2021 |
| Pricing | $147 one-time purchase |
| Platforms | Web-based (browser), works on all platforms. Limited offline mode via PWA. |
| User base | Not publicly disclosed. Relatively small but growing, primarily in the indie publishing community. |

**Popularity:** Well-known in self-publishing circles, largely due to Dave Chesson's marketing through Kindlepreneur (a major self-publishing blog). Not widely known outside the indie author community. Frequently recommended as the "Vellum alternative for non-Mac users."

**Public sentiment:** Writers praise Atticus for formatting — professional-quality book interiors, KDP-optimized templates, footnote/endnote support, real-time preview across e-reader formats. Writers criticize its editor as deliberately minimal — no plotting, no research features, no grammar checker. The import process is rough (doesn't recognize headings from Google Docs). The consensus: Atticus is excellent at making a finished manuscript look professional, but not at helping you write it.

One reviewer captured the dynamic: "Most writers will still want a separate app for the actual drafting and editing phases — Atticus excels at making your finished manuscript look polished, not at helping you write it."

**Smudge positioning vs. Atticus:** Minimal overlap. Atticus is a formatting tool; Smudge is a writing tool. They could coexist in a workflow. When Smudge ships Phase 3 (Export) with professional templates, it starts to encroach on Atticus's territory — but Atticus's formatting depth (17 templates, decorative page breaks, text message formatting, trim size optimization) will be hard to match quickly. The premium template pack from the monetization strategy is the right response: offer good-enough formatting that satisfies most writers, and let Atticus own the high-end formatting niche.

---

### Dabble

**The friendly middle ground between Word and Scrivener.**

| Attribute | Detail |
|-----------|--------|
| Developer | Dabble (small team) |
| First released | ~2018 |
| Pricing | $9–$29/month subscription, $699 lifetime |
| Platforms | Web, desktop apps (Windows, Mac, Linux), mobile (iOS, Android) |
| User base | Not publicly disclosed. |

**Popularity:** Moderate and growing. Frequently mentioned in comparison articles alongside Scrivener and Atticus. Positioned as "Scrivener but easier" — cloud-based, auto-save, cross-device sync, focus mode. The Plot Grid feature (visual plot mapping) is its most distinctive capability.

**Public sentiment:** Writers praise the simplicity, auto-save, and cross-device experience. Writers criticize the subscription pricing (especially compared to Scrivener's $49 one-time fee), the lack of advanced formatting for publishing, and the limitation that collaboration requires both parties to have a subscription. Reedsy's review rated it 2.5/5, noting it's "well-suited for writers who want a clean, cloud-based drafting environment" but "not quite" the one app to rule them all.

**Smudge positioning vs. Dabble:** Direct competition on the "simpler than Scrivener, designed for books" positioning. Smudge's advantages: free, open source, self-hosted (no subscription anxiety), export included. Dabble's advantages: polished product with years of iteration, mobile apps, Plot Grid, "Read to Me" feature, established user base. The subscription pricing is Dabble's vulnerability — writers resent it, and Smudge's free model is a direct counter.

---

### Reedsy Studio

**The free-tier all-in-one for self-publishers.**

| Attribute | Detail |
|-----------|--------|
| Developer | Reedsy (UK, backed by publishing industry) |
| First released | 2016 |
| Pricing | Free core features; Craft add-on and Outlining add-on at $10.99/month combined |
| Platforms | Web only |
| User base | 85,000 writers in Studio; over 1 million authors on the Reedsy platform |

**Popularity:** High and growing. Reedsy Studio benefits from the broader Reedsy ecosystem (marketplace for editors, designers, and marketers). The free tier is generous — writing, collaboration, and basic formatting are all free. Frequently ranked #1 in "best writing tools" articles (though many of those articles are published by Reedsy itself, so take that with a grain of salt).

**Public sentiment:** Writers appreciate the free tier, the clean interface, the collaboration features, and the integrated formatting/export. The premium features (goals, version history, dark mode, advanced planning boards) are seen as reasonable add-ons. Criticism centers on the web-only nature (no offline writing), the relatively basic plotting tools compared to Scrivener or Plottr, and the fact that some features that feel fundamental (dark mode, version history) require paying.

**Smudge positioning vs. Reedsy Studio:** Reedsy Studio is the closest analog to what Smudge aspires to be — a web-based tool that combines writing, organization, and export. Key differences: Smudge is self-hosted (data stays on your machine), MIT-licensed (no vendor lock-in), and doesn't gate any features behind a paywall. Reedsy's advantage is the ecosystem (marketplace, courses, community of 750,000+ writers) that Smudge can't match. The risk: Reedsy Studio improves faster than Smudge ships, and the free tier is "good enough" that writers don't see a reason to self-host.

---

### Novlr

**The community-first writing app.**

| Attribute | Detail |
|-----------|--------|
| Developer | Novlr (small team, "created by writers, for writers") |
| First released | 2015 |
| Pricing | Free Starter plan; $8/month Plus; $18/month Pro. Lifetime access $499. |
| Platforms | Web only |
| User base | Not publicly disclosed. Active Discord community with writing sprints three times per week. |

**Popularity:** Niche but well-regarded. Known more for its community (Discord, writing sprints, integrated courses) than for its feature set. Mentioned in most comparison articles but rarely as the top recommendation.

**Public sentiment:** Writers praise the clean interface, the community feel, and the distraction-free mode. Writers criticize the subscription pricing for what feels like a relatively simple editor — limited formatting, no deep organization, no research tools. Kindlepreneur's review summarized: "once you look at the price, it's hard to justify."

**Smudge positioning vs. Novlr:** Smudge offers more features at a lower price (free). Novlr's community is its moat — Smudge would need to build its own community over time to compete on that dimension.

---

### Plottr

**The dedicated visual story planner.**

| Attribute | Detail |
|-----------|--------|
| Developer | Plottr (Cameron Sutter) |
| First released | ~2019 |
| Pricing | $60/year or $199+ lifetime |
| Platforms | Desktop (Windows, Mac), with cloud sync |
| User base | Over 30,000 writers |

**Popularity:** Strong in the plotting/planning niche. Not a drafting tool — it's designed to be used alongside a writing app (typically Scrivener or Word). Popular with writers who plan extensively before drafting.

**Public sentiment:** Praised for visual timelines, character sheets, series management, and story structure templates (Hero's Journey, Save the Cat, Snowflake). Criticized for not being a writing tool — you plan in Plottr, then switch to another app to write, which creates the same workflow fragmentation problem.

**Smudge positioning vs. Plottr:** Smudge's scene cards (Phase 5a) and timeline view (Phase 5c) compete with Plottr. The advantage is integration — plan and write in the same tool. The disadvantage is that Plottr has years of specialized development in visual planning that Smudge won't match quickly. Plottr users who value the visual planning workflow may use Plottr *alongside* Smudge, just as they use it alongside Scrivener.

---

### Ulysses

**The Apple writer's darling.**

| Attribute | Detail |
|-----------|--------|
| Developer | The Soulmen (Germany) |
| Pricing | $49.99/year subscription (was one-time purchase, switched to subscription — generated significant backlash) |
| Platforms | macOS, iOS only |
| User base | Not publicly disclosed. |

**Popularity:** Strong loyalty among Apple users. Known for its minimalist, beautiful interface and Markdown-based writing. The switch from one-time purchase to subscription in 2017 alienated a segment of users — "users who originally paid full price for a permanent license had their access revoked when Ulysses switched to a subscription model" according to Kindlepreneur reviews.

**Public sentiment:** Writers who use it love the clean design, the iCloud sync, and the Markdown workflow. Writers who left resent the subscription switch. The Apple-only limitation excludes Windows and Linux users entirely.

**Smudge positioning vs. Ulysses:** Minimal overlap. Ulysses targets Apple-exclusive writers who prefer Markdown. Smudge targets cross-platform writers who prefer rich text. Ulysses' subscription pricing and the backlash from the pricing switch is a cautionary tale that validates Smudge's "free, no subscription" commitment.

---

### Obsidian

**The knowledge worker's writing tool (adapted for fiction).**

| Attribute | Detail |
|-----------|--------|
| Developer | Dynalist Inc. (small team) |
| Pricing | Free for personal use; $50/year for commercial use. Sync: $4/month. |
| Platforms | Windows, macOS, Linux, iOS, Android |
| User base | Not publicly disclosed, but large and active community. |

**Popularity:** Extremely popular among tech-savvy writers, particularly for world-building and research organization. Not designed as a book-writing tool, but adapted for it through plugins and community workflows. Frequently mentioned in Reddit writing communities, especially by fantasy and sci-fi writers.

**Public sentiment:** Loved for its flexibility, linked-notes approach (Zettelkasten), graph view, and the fact that files are plain Markdown on disk (maximum data portability). Criticized as requiring significant setup — "it's a sandbox, not a guided tour." The learning curve is comparable to Scrivener's, but for different reasons (you're building your own system rather than learning someone else's).

A representative quote: "As a fantasy writer, Obsidian is my holy grail. I can link character profiles to locations, to plot points, to magic systems. The graph view shows me how everything connects."

**Smudge positioning vs. Obsidian:** Obsidian is a general-purpose knowledge tool that writers adapt; Smudge is a purpose-built writing tool. For world-building and research organization, Obsidian's linked-notes approach is more powerful and flexible. For actual book writing (chapters, preview, export, word count goals), Smudge is purpose-built. Some writers will use both — Obsidian for research and world-building, Smudge for drafting and export.

---

### FocusWriter

**The distraction-free purist.**

| Attribute | Detail |
|-----------|--------|
| Developer | Graeme Gott (solo developer, open source) |
| Pricing | Free (open source) |
| Platforms | Windows, macOS, Linux |
| User base | Not publicly disclosed. Small but dedicated. |

**Popularity:** Niche. Known in writing communities as the tool for writers who want absolute minimalism — customizable backgrounds, hidden toolbar, timers, daily goals, and nothing else.

**Public sentiment:** Loved for doing one thing brilliantly — creating a calm, focused writing environment. No one criticizes FocusWriter for lacking features because that's the point. Writers use it for first drafts, then move to Scrivener or Word for everything else.

**Smudge positioning vs. FocusWriter:** Smudge's distraction-free mode (Phase 7, recommended to move earlier) should feel as calm as FocusWriter. If it does, writers who currently use FocusWriter for drafting + Scrivener for organization can consolidate into Smudge.

---

### World-Building Specialists: Campfire & World Anvil

**Campfire** (modular pricing, ~$6–$15/module) — Dedicated modules for characters, magic systems, species, languages. Popular with fantasy/sci-fi writers. Not a drafting tool.

**World Anvil** (freemium, up to $60/year) — Online world-building wiki platform. Massive feature set. Community-driven. Not a drafting tool.

Both are highly specialized and serve a niche that Smudge's Phase 5 (Fiction Mode) touches but doesn't fully replace. Writers in this niche are passionate and loyal to these tools. Smudge's character sheets and world-building bible will serve writers who want a lighter version integrated with their writing; dedicated world-builders will likely stick with the specialized tools.

---

### AI-Augmented Writing Tools: Sudowrite & Novelcrafter

**Sudowrite** ($19–$59/month) — AI writing assistant specifically for fiction. Has its own model trained for natural-sounding prose. Tools for brainstorming, scene expansion, and description enhancement. Recently added project-wide find and replace.

**Novelcrafter** ($14+/month) — AI-powered planning and writing with a "Codex" knowledge base for characters and locations. Version control. Multiple AI model support.

**Public sentiment:** Sudowrite is well-regarded among writers who use AI as a brainstorming partner ("I'd never use Sudowrite to write a book for me. But it can help when I'm stuck"). Novelcrafter is newer but praised for its integrated knowledge base approach. Both are subscription-only.

**Smudge positioning:** Smudge deliberately does not include AI writing features in its core. This is a philosophical choice aligned with the ethos ("Smudge helps writers write, it doesn't write for them"). AI could be available as an optional plugin in the future marketplace (Phase 7+), but it's never built-in. This positions Smudge on the "authentic writing" side of the market — which is where the competitive analysis suggests sentiment is moving.

---

## Landscape Summary

| Tool | Price | Platform | Best For | Popularity | Smudge Overlap |
|------|-------|----------|----------|------------|----------------|
| Scrivener | $49 one-time | Desktop + iOS | Complex projects, organization | Very High (market leader) | High — direct competitor |
| MS Word | $70/year subscription | All | General writing, submissions | Very High (default) | Medium — Smudge replaces for book work |
| Google Docs | Free | Web, mobile | Collaboration, casual writing | Very High | Medium — Smudge replaces for book work |
| Atticus | $147 one-time | Web | Formatting + light writing | Moderate (indie niche) | Low — complementary |
| Dabble | $9–29/month | Web, desktop, mobile | Clean drafting + plotting | Moderate | High — similar positioning |
| Reedsy Studio | Free / $11/month | Web | All-in-one for self-publishers | High (85K in Studio) | High — closest analog |
| Novlr | Free / $8–18/month | Web | Community, distraction-free writing | Low-Moderate | Medium |
| Plottr | $60/year | Desktop | Visual story planning | Moderate (30K users) | Low — complementary |
| Ulysses | $50/year | Apple only | Minimalist Markdown writing | Moderate (Apple niche) | Low |
| Obsidian | Free | All | Knowledge management, world-building | High (tech-savvy niche) | Low — different purpose |
| FocusWriter | Free | Desktop | Distraction-free drafting | Low (niche) | Low — Smudge subsumes |
| Campfire | $6–15/module | Web | World-building (fantasy/sci-fi) | Low (niche) | Low — Phase 5 overlaps lightly |
| World Anvil | Free / $60/year | Web | World-building wiki | Moderate (niche) | Low — Phase 5 overlaps lightly |
| Sudowrite | $19–59/month | Web | AI-assisted fiction writing | Moderate (growing) | None — different philosophy |
| Novelcrafter | $14+/month | Web | AI-powered planning + writing | Low (newer) | None — different philosophy |

---

## Where Smudge Fits

Smudge's competitive position is defined by three axes:

**Axis 1: Free and self-hosted.** No other tool in this market is simultaneously free, open source, self-hosted, and purpose-built for book writing. FocusWriter is free and open source but is a minimal text editor. Reedsy Studio has a generous free tier but is web-hosted (your data is on their servers) and gates features behind a paywall. Smudge is the only tool where the writer pays nothing, owns their data completely, and gets the full feature set. This is a unique and defensible position.

**Axis 2: Non-fiction integration.** No tool in the market integrates a research library, semantic citations, fact-check status tracking, and argument structure visualization into the writing experience. Scrivener comes closest (research storage, footnotes, split screen) but its citation workflow requires external tools and manual processes. Smudge's Phase 6a features, if executed well, address a gap that no competitor has filled. This is the market opportunity — not "a better Scrivener" but "the first tool where research and prose are semantically connected."

**Axis 3: Simplicity without sacrifice.** The simplicity-vs-power tension is the defining challenge of the market. Every tool either overwhelms (Scrivener) or underdelivers (FocusWriter, Google Docs). Smudge's architecture — collapsible sidebar, hideable reference panel, distraction-free mode — is designed to resolve this tension. Whether it succeeds depends on execution, not features.

---

## Key Takeaways for Smudge Development

1. **Scrivener is the benchmark**, not because Smudge should clone it, but because every writer evaluates new tools against it. Understanding why writers love and hate Scrivener is essential.

2. **The learning curve is the opportunity.** Scrivener's complexity scares away a large segment of writers. Smudge's first impression must be "I can use this immediately" — no tutorials, no onboarding wizards, no two-weekend learning investment.

3. **Export quality matters more than most features.** Writers choose tools partly based on what the finished product looks like. A clean .docx export and a professional PDF are higher-impact than many features.

4. **The multi-tool problem is real.** Writers use 2–5 tools because no single tool handles the full workflow. Every tool Smudge subsumes (a separate note-taking app, a separate citation manager, a separate distraction-free editor) is friction removed from the writer's life.

5. **The non-fiction gap is real but nuanced.** Scrivener serves non-fiction writers adequately for organization and drafting. The gap is specifically in *semantic integration* between research and prose — citations that know their source, claims that have verification status, argument structure that exists as a navigable view. This is Smudge's most novel and defensible opportunity.

6. **"Free, no subscription, your data" is a headline, not a footnote.** In a market defined by subscription fatigue and data anxiety, Smudge's architecture is its most distinctive competitive advantage.

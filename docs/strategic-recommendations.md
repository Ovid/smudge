# Smudge — Strategic Recommendations from Competitive Analysis

**Date:** 2026-03-29
**Source:** Competitive landscape research across writing tools (Scrivener, Atticus, Dabble, Novlr, Reedsy Studio, Obsidian, Ulysses, FocusWriter, Plottr, Campfire, World Anvil, and others), writer forums, Reddit discussions, and review articles.
**Companion to:** Smudge MVP PRD v0.3.0, Feature Roadmap v0.4.0

---

## Ignore all recomendations that suggest reordering the roadmap phases. The roadmap is already flexible enough to accommodate these changes without disruption. The recommendations are about *what* to prioritize, not *when* to build it.

## Context

These recommendations are derived from patterns observed across dozens of writer reviews, forum threads, and comparison articles. They represent adjustments to Smudge's priorities and positioning based on what writers *actually* cite as reasons for choosing, staying with, or abandoning a tool — not what tool makers assume writers want.

Each recommendation includes: what to change, why (grounded in the research), the impact if we act on it, and the risk if we don't.

---

## Recommendation 1: Promote Dark Mode to Phase 1 or 2

### What

Move dark mode from Phase 7 (Polish & Power) to Phase 1 or Phase 2. The MVP PRD should mandate CSS custom properties / Tailwind design tokens for all colors, backgrounds, borders, and shadows (you've already flagged this). The actual dark theme swap should ship within the first or second phase after MVP, not as late-stage polish.

### Why

Dark mode is cited in virtually every writing tool comparison article and forum thread. Writers work at night. They stare at screens for hours. Tools that lack dark mode are flagged as having a gap, not a missing luxury. Reedsy Studio locks dark mode behind its premium tier — writers complain about this specifically.

The competitive landscape has moved: Scrivener has dark mode. Dabble has it. Ulysses has it. Novlr has it. Reedsy charges for it. Writers now *expect* it on day one. Shipping without it doesn't feel "minimal" — it feels unfinished.

### Impact if we act

Smudge immediately feels like a mature, writer-first tool from the earliest phases. The implementation cost is low (a CSS custom property swap) if the groundwork is laid in the MVP. Writers who work at night — which is a large percentage of the audience — can use Smudge comfortably from the start.

### Risk if we don't

Writers evaluating Smudge compare it against tools that all have dark mode. Its absence creates a "not ready for real use" perception that's disproportionate to the effort required to add it. Some writers will literally not adopt a tool that lacks dark mode because they work primarily at night.

### Effort estimate

If CSS custom properties are used from the MVP: approximately 1–2 days of work to define the dark palette, test contrast ratios for WCAG AA, and add the toggle with system preference detection.

---

## Recommendation 2: Promote Distraction-Free Mode to Phase 2 or 3

### What

Move distraction-free mode from Phase 7 to Phase 2 or 3. This means: a full-screen writing mode that hides the sidebar, toolbar, reference panel, and status bar, leaving only the writer's text centered on screen. Activated by a keyboard shortcut. The formatting toolbar appears contextually on text selection. Auto-save continues silently. Escape or mouse movement reveals the UI.

### Why

The single most striking pattern in the competitive research is that writers are torn between two contradictory needs: "I want all my tools in one place" (which favors complex, feature-rich tools like Scrivener) and "I just want to write without distractions" (which favors minimal tools like FocusWriter or Calmly Writer). No tool resolves this tension well.

Writers end up using multiple tools — Scrivener for organization, FocusWriter or a separate distraction-free app for actual drafting — because no single tool can be both organized and peaceful. This is the core design challenge in writing software.

Smudge's architecture is uniquely well-positioned to solve this: the collapsible sidebar, the hideable reference panel, and the clean editor-centered layout mean distraction-free mode is an extension of the existing UI, not a separate mode bolted on top. Proving that Smudge can be both organized *and* peaceful — early in its life — is a strategic differentiator that no competitor matches.

FocusWriter, one of the most loved distraction-free tools, is literally just a full-screen text editor with a hidden toolbar and customizable background. It has no organization, no chapters, no export. Writers love it anyway because the *feel* of writing in it is so good. Smudge can offer that same feeling while also being a complete book-writing tool.

### Impact if we act

Smudge becomes the first tool that genuinely resolves the simplicity-vs-power tension. Writers don't need a separate distraction-free app. The "just me and my words" experience coexists with the "everything organized in one place" experience in the same tool. This is a strong narrative for adoption and a defensible differentiator.

### Risk if we don't

Writers who prefer distraction-free drafting (a significant segment) will use Smudge for organization and export but draft in a separate tool, reducing engagement and creating the same fragmented workflow that drives dissatisfaction with existing tools.

### Effort estimate

Moderate. The core mechanic is hiding UI elements and centering the editor. The contextual toolbar on text selection requires some TipTap configuration. The keyboard shortcut infrastructure already exists from the MVP. Estimate: 3–5 days.

---

## Recommendation 3: Lead with Non-Fiction for Phases 5/6

### What

The roadmap already allows Phases 5 (Fiction) and 6 (Non-Fiction) to be built in either order. This recommendation is to explicitly prioritize Phase 6a (Research & Citations) before Phase 5a (Characters & Scenes) — and to make non-fiction Smudge's *leading narrative* when it comes to positioning and messaging.

### Why

The fiction writing tool market is crowded. Scrivener, Dabble, Novlr, NovelPad, Campfire, World Anvil, Plottr, and many others compete for fiction writers. Character sheets, scene cards, and world-building exist in multiple established tools. Smudge would be entering a space with strong incumbents and high expectations.

The non-fiction writing tool market is genuinely empty. Non-fiction writers — the kind writing research-heavy, argument-driven books — have no dedicated tool. They cobble together workflows from 3–5 separate tools: Scrivener for organization, Zotero for citations, Obsidian or Notion for research notes, Word for collaboration with editors, and sometimes a separate outliner for argument structure. Every tool transition risks data loss and workflow friction.

Smudge's Phase 6a features (research library, citation management, fact-check flags, research side panel) address a gap that no competitor has filled. "The writing tool that actually handles research" is a positioning statement no one else can make. When non-fiction writers search for tools, they find fiction-first software that awkwardly accommodates non-fiction as an afterthought — or they find academic tools (LaTeX, Zotero) that are powerful but hostile to non-academic writers.

You are also personally writing a non-fiction book (*Bread, Circuses, and GPUs*). Building non-fiction mode first means you're dogfooding it immediately, which produces better design decisions than building fiction features you won't use for months.

### Impact if we act

Smudge enters an uncontested market. Non-fiction writers who have been underserved for years find a tool built for their workflow. The positioning is unique and defensible. Smudge's reputation is established in a niche before competing in the crowded fiction space.

Fiction mode still gets built — it's just not the *first* story Smudge tells. When it arrives, it benefits from the infrastructure (reference panel, TipTap custom marks, tagging) already proven in non-fiction.

### Risk if we don't

Smudge enters the fiction tool market as one of many, competing against Scrivener's 15+ year head start and a dozen modern alternatives. Its most novel features (research management, citations, fact-checking, argument structure) are delayed behind fiction features that already exist elsewhere. The non-fiction market opportunity may be claimed by another tool in the meantime.

### Note

This doesn't mean deprioritizing fiction permanently. It means shipping Phase 6a before 5a, and building the brand narrative around non-fiction first. Fiction follows naturally — the infrastructure is shared.

---

## Recommendation 4: Emphasize "Free, Self-Hosted, Your Data" as a Core Differentiator

### What

When Smudge reaches Electron distribution (or even before, when it's shared with other writers as a Docker image), the messaging should lead with: "Free. No subscription. No account. Your writing stays on your computer." This should be the headline, not a footnote.

### Why

Writer hostility toward subscription pricing is one of the strongest and most emotional patterns in the research. Writers calculate the 10-year cost of subscriptions and get angry. They worry about what happens to their manuscripts if they stop paying. They resent paying during months they're not actively writing. Multiple articles and forum threads are dedicated entirely to this topic.

One article summarized the sentiment: "Writers end up renting their own workflow piece by piece, forever chasing the version that used to come with a single purchase." Another: "Subscription platforms have an incentive to keep you engaged, not with your writing, but with their ecosystem."

The tools with the highest writer goodwill (Scrivener at $49, Atticus at $147) are one-time purchases. Dabble added a $699 lifetime option specifically because writers demanded it. Reedsy Studio's free tier is a major draw.

Smudge is *free*. Not freemium, not free-with-limits, not free-trial-then-subscription. Free. And the writer's data lives on their own machine in a SQLite file they can back up, inspect, or migrate. No cloud account, no vendor lock-in, no "what happens if this company goes away?"

In a market where every competitor either charges a subscription, requires an account, or stores data on their servers, this is a genuine and defensible differentiator. It's also philosophically aligned with the kind of writer who values independence and ownership — exactly the audience for a tool like Smudge.

### Impact if we act

Smudge's positioning is immediately distinctive. Writers who are subscription-fatigued (a large segment) have a clear reason to try it. The "your data stays on your computer" message resonates with writers who've been burned by cloud services shutting down or changing pricing. It builds trust before a single feature is evaluated.

### Risk if we don't

Smudge is perceived as "another writing tool" competing on features. Its most unusual structural advantage (free, local, no account) is buried in technical documentation rather than surfaced as a reason to care.

### Implementation

This is a messaging and documentation change, not a code change. When Smudge has a README, landing page, or any public-facing description, lead with the pricing/data ownership story. The feature list comes second.

---

## Recommendation 5: Invest in the Feel — Budget Time for Polish in Every Phase

### What

Allocate explicit time in every phase (not just Phase 7) for typography refinement, whitespace tuning, animation subtlety, transition polish, and the sensory experience of writing in Smudge. This isn't a vague aspiration — it means including specific tasks in each phase's PRD: "spend N hours on editor typography tuning," "test the feel of sidebar collapse/expand on three screen sizes," "review the reading experience in preview mode at 10,000+ words."

### Why

The most consistent thing writers say about the tools they love is some variation of "it gets out of my way" or "it feels like an extension of how I think." The most consistent thing they say about tools they abandon is "fighting the software," "clutter," "distracting."

This isn't about features — it's about *texture*. The font choice in the editor. The line height. The speed of auto-save feedback. The warmth of the color palette. The behavior of the cursor when you switch chapters. The absence of unnecessary chrome.

One writer described trying Scrivener: all the organizational features — character sheets, notes, research files — were "right there, staring at me." The tool was powerful, but it felt like clutter. The writer went back to Microsoft Word — a vastly less capable tool — because Word felt like "a great, vast, gaping emptiness, waiting for words."

Another writer, reviewing 22 tools, rated one down because of "a permanent upgrade prompt and navigation banner I can't get rid of" in the sidebar. The tool's features were fine. The feel was broken by a single persistent UI element.

The implication is stark: Smudge can have every feature in the roadmap and still fail if the writing experience feels cluttered, hurried, or inattentive. Conversely, a Smudge MVP with perfect typography, warm colors, calm transitions, and a respectful absence of unnecessary elements will earn loyalty even before the advanced features arrive.

### Impact if we act

Every phase of Smudge ships feeling polished and intentional. Writers evaluate the tool based on how it feels to write in, and the feel is good from day one. Incremental improvements to the experience compound across phases. The warm, writerly tone established in the MVP's visual identity guidelines (§7.1) is actually realized in the product, not just specified in a document.

### Risk if we don't

Smudge accumulates "feature debt in the feel department" — features work correctly but the experience of using them is rough. Writers try Smudge, find the features promising, but go back to their existing tool because it "just feels better to write in." Polish is deferred to Phase 7, by which point the accumulated roughness is too much to fix without a visual redesign.

### Implementation

Add a "Polish" section to each phase's PRD with specific feel-related tasks. Examples:

- Phase 0 (MVP): Test the editor writing experience with 5,000+ words of real prose. Adjust line height, paragraph spacing, font rendering, and cursor behavior until it feels calm. Test the save indicator — does "Saved" appearing feel reassuring or noisy?
- Phase 1 (Dashboard): Does the chapter status badge feel like a gentle label or a project management widget? Test with a 20-chapter manuscript — does the sidebar feel organized or overwhelming?
- Phase 2 (Goals): Does the burndown chart feel encouraging or anxiety-inducing? Test with a writer who is behind schedule — does the UI feel judgmental?
- Phase 3 (Export): Does the export confirmation feel like a celebration or a receipt?

---

## Recommendation 6: Consider a "Continuity Checker" as a Novel Differentiating Feature

### What

Add a new feature concept to the roadmap (potentially Phase 5b or as a standalone feature): a searchable registry of established facts about the manuscript. The writer (or eventually, an AI assistant) logs factual assertions as they appear in the text: "Character X: eye color = blue, established in Chapter 2." "The café is on Elm Street, established in Chapter 5." "The war ended in 1453, established in Chapter 8."

When a contradictory detail appears later in the manuscript, the system flags it: "You described Maria's eyes as brown in Chapter 14, but they were established as blue in Chapter 2."

### Why

No writing tool currently offers this. It's a real problem that writers solve with spreadsheets, memory, or painful re-reads. Continuity errors are one of the most common and embarrassing flaws in published books, and they're notoriously hard to catch during editing because the relevant details can be separated by hundreds of pages.

The research surfaced this indirectly in several places. Writers cite Scrivener's ability to "keep notes and character sheets alongside the manuscript" as a workaround for consistency, but notes don't actively check for contradictions — they're passive reference. Writers describe spending hours "checking for consistency" before submission.

For non-fiction, the parallel is even stronger: was this statistic cited as "42%" in Chapter 3 and "45%" in Chapter 9? Did you say the enclosure movement began in the 15th century in one place and the 16th century in another? Factual consistency across a 80,000-word argument-driven book is a genuine, unsolved problem.

### How it could work

**Phase 1 (Manual):** A simple "Facts" panel where the writer manually logs assertions (entity, attribute, value, source chapter/paragraph). The panel is searchable and sortable. When writing, the writer can search their facts registry to check before asserting something. This is essentially a structured notepad — low effort, high utility.

**Phase 2 (Semi-Automatic):** The writer highlights a sentence and clicks "Log Fact." Smudge extracts the entity, attribute, and value (with writer confirmation) and adds it to the registry with a link back to the source paragraph.

**Phase 3 (Automated Detection, future):** An AI-assisted pass over the manuscript that identifies potential contradictions by comparing new assertions against the registry. This is the ambitious version and depends on LLM integration, but even a basic keyword-matching approach ("you mentioned 'blue eyes' and 'brown eyes' for the same character name") would catch common errors.

### Impact if we act

Smudge would have a feature that no other writing tool offers. For fiction writers managing complex casts of characters across long manuscripts, and for non-fiction writers maintaining factual consistency across dense, research-heavy arguments, this is the kind of feature that generates word-of-mouth. "My writing tool actually catches contradictions" is a compelling story.

### Risk if we don't

No immediate risk — this is an additive feature, not a gap. But it represents an opportunity to own a genuinely novel capability in a market where most tools are competing on variations of the same feature set.

### Effort estimate

The manual version (Phase 1 of the concept — a structured "Facts" panel) is a small feature: one new database table, a panel in the reference panel, and a search interface. Comparable in effort to the scratchpad/outtakes feature. The semi-automatic and automated versions are progressively more complex and could be their own roadmap phases.

### Where it fits in the roadmap

The manual version could slot into Phase 5a (alongside character sheets, which are a related concept — structured facts about entities in the story) or Phase 6a (alongside fact-check flags, which address a related concern — "is this claim verified?"). It could also stand alone as a small feature in any phase after Phase 4 (when the reference panel exists).

---

## Summary

| # | Recommendation | Priority Change | Effort | Impact |
|---|----------------|----------------|--------|--------|
| 1 | Dark mode → Phase 1 or 2 | Move from Phase 7 | Low (1–2 days if CSS groundwork laid) | High — expected by writers, missing feels unfinished |
| 2 | Distraction-free mode → Phase 2 or 3 | Move from Phase 7 | Moderate (3–5 days) | High — resolves the core tension in writing tools |
| 3 | Lead with non-fiction (Phase 6a before 5a) | Reorder within existing flexibility | None (same work, different order) | High — enters uncontested market, aligns with current project |
| 4 | "Free, self-hosted, your data" as headline | Messaging, not code | None | High — strongest differentiator in a subscription-hostile market |
| 5 | Budget polish time in every phase | Process change | ~10% time per phase | High — feel drives loyalty more than features |
| 6 | Continuity checker as novel feature | New addition to roadmap | Low (manual version) to High (automated) | Medium-High — genuinely novel, strong differentiator |

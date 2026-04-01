# Bugs

- Formatting bar scrolls away as chapter gets longer. Need to make it sticky,
  put it in the topbar, or something.
- MAJOR: I entered text for the body of a chapter, changed the title (might be
  a red herring), clicked on "Preview", when I get get back to chapters, it
  shows me, it showed me the original text, not the new text. When I clicked
  another chapter and clicked back, it was fine. Also, when I clicked back to
  the editor view, it  showed me the first chapter, not the chapter I was
  editing.
- When clicking on a chapter in the sidebar, I must always enter the "editor"
  view for that chapter. Currently, if I'm in preview or dashboard, clicking
  on a chapter does nothing.
- Dashboard view: when changina a title, it's not immediately reflected in the
  dashboard. Need to refresh the page to see the change.
- I can't style the chapter titles.
- Logo on every page. When I'm on chapters, for example, sidebar has the title
  up top, not the logo.
- Better styling on main page. Simple is good? Need sorting, filtering.

# Features

- CI/CD
- Headings listed as H1, H2, H3
- BE ULTRA-PARANOID ABOUT DATA LOSS. Brainstorm on ways to make this
  super robust. Have "snapshots" which go back X amount of time.

- Save files in .smg format? (Is that extension taken?)
- Research page width and what formatting features writers really need. Maybe
  have a "simple" mode and an "advanced" mode? Or just make it simple and add
  features as needed.
- Need help page. Not until close to done. CLAUDE.md instructions to ensure
  it's updated after every public-facing change.
- Logo should link to github repo. Eventually, to a website.
- i18n
- Import from Word, Google Docs, etc.
- Screenplay support? Final Draft support? Fountain support?
- Shareable README
- Red line for spelling errors needs to be more visible.
- Can we do grammar checks?
- Search by regex? Is there a way that non-technical users can use regex?
  Search should be "this chapter" or "all chapters"?

# Explore

- Plaiwright — like Playwright, but it's a test that Claude can run and
  examine screenshots for issues. Brainstorm this. jsonl log for what each
  screenshot represents? Clean up after? Artifacts in .gitignore. Kiro/Claude
  skill? Run as data-driven loop? AI feeds in data, plaiwright validates, and
  then it runs. AIAT (vs. UAT)

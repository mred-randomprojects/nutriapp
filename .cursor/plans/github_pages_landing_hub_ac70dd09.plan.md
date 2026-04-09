---
name: GitHub Pages landing hub
overview: Create a new `mred-randomprojects.github.io` repo with a single dark-themed landing page that links to the three project tools.
todos:
  - id: create-repo
    content: Create mred-randomprojects.github.io repo on GitHub
    status: pending
  - id: create-html
    content: Create index.html with dark-themed landing page and 3 tool cards
    status: pending
  - id: push-deploy
    content: Push to main and verify the site is live
    status: pending
isProject: false
---

# GitHub Pages Landing Hub

## Goal

When visiting `https://mred-randomprojects.github.io/`, users see a dark-themed landing page with cards linking to the three tools:

- **Candito Tool** → `/candito-tool/`
- **LoL Guess Champ Class** → `/lol-guess-champ-class/`
- **NutriApp** → `/nutriapp/`

## Approach: Single static HTML file (no build step)

Since this is just a landing page with 3 cards, a full React/Vite app would be overkill. A single `index.html` with embedded CSS is simpler, deploys instantly, and has zero maintenance cost.

## Visual Style

Match the dark theme shared across the apps:
- **Background:** near-black blue-gray (`hsl(240, 15%, 4%)` — same as candito-tool)
- **Cards:** dark surface (`hsl(240, 12%, 8%)`) with subtle border, rounded corners, hover glow
- **Accent:** green (`hsl(152, 76%, 42%)` — nutriapp's primary) for headings and hover effects
- **Font:** Inter / system-ui sans-serif stack (matches candito-tool)
- **Layout:** centered grid of 3 cards, responsive (1 col on mobile, 3 on desktop)

Each card would show:
- Tool name
- One-liner description
- A subtle accent-colored link/button

## Steps

### 1. Create the repo on GitHub

```bash
gh repo create mred-randomprojects/mred-randomprojects.github.io --public --description "Landing page for my tools"
```

### 2. Clone it locally and add `index.html`

```bash
cd ~/Documents/Programming
git clone git@github-mred:mred-randomprojects/mred-randomprojects.github.io.git
cd mred-randomprojects.github.io
```

Then create a single `index.html` with:
- Inline `<style>` block with the dark theme CSS
- 3 clickable cards in a responsive CSS grid
- No JavaScript framework, no build step

### 3. Push and enable Pages

```bash
git add index.html
git commit -m "Landing page with links to tools"
git push -u origin main
```

GitHub automatically serves `*.github.io` repos from the `main` branch — no Pages configuration needed for the special user-site repo.

### 4. Verify

Visit `https://mred-randomprojects.github.io/` — should show the landing page immediately (may take ~1 min for first deploy).

## Result

```
https://mred-randomprojects.github.io/
  ├── /candito-tool/        (separate repo, already deployed)
  ├── /lol-guess-champ-class/ (separate repo, already deployed)
  └── /nutriapp/            (separate repo, deploying now)
```

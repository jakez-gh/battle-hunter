#!/usr/bin/env bash
# Deploy Battle Hunter to the internet.
# Tries automated options first; falls back to step-by-step instructions.

set -e

echo "=== Battle Hunter Deploy ==="
echo ""

# No build step: pure static site — deploy source directly.

# ─────────────────────────────────────────────────────────────
# Option A: GitHub Pages via gh CLI (fully automated)
# ─────────────────────────────────────────────────────────────
if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null 2>&1; then
        REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
        if [[ -n "$REPO" ]]; then
            echo "GitHub repo: $REPO"

            # Push latest commits so the live site is current.
            echo "Pushing latest commits..."
            git push 2>/dev/null || echo "(Nothing new to push.)"

            # Check if Pages is already enabled.
            PAGES_URL=$(gh api "repos/$REPO/pages" -q .html_url 2>/dev/null || true)
            if [[ -n "$PAGES_URL" ]]; then
                echo ""
                echo "GitHub Pages is already enabled."
                echo "Your game is live at: $PAGES_URL"
                echo "(Changes just pushed will appear within 1-2 minutes.)"
                exit 0
            fi

            # Enable Pages for the first time.
            echo "Enabling GitHub Pages..."
            BRANCH=$(git branch --show-current)
            if gh api "repos/$REPO/pages" -X POST \
                   -F "source[branch]=$BRANCH" -F "source[path]=/" &>/dev/null 2>&1; then
                sleep 2
                PAGES_URL=$(gh api "repos/$REPO/pages" -q .html_url 2>/dev/null || true)
                echo ""
                echo "GitHub Pages enabled!"
                [[ -n "$PAGES_URL" ]] && echo "Your game will be live at: $PAGES_URL"
                echo "(It may take 1-2 minutes to appear.)"
                exit 0
            else
                echo "Could not enable Pages automatically (repo may be private or org-restricted)."
                echo ""
            fi
        fi
    else
        echo "gh CLI found but not authenticated — run: gh auth login"
        echo ""
    fi
fi

# ─────────────────────────────────────────────────────────────
# Option B: Netlify CLI
# ─────────────────────────────────────────────────────────────
if command -v netlify &>/dev/null; then
    echo "Netlify CLI found. Deploying..."
    netlify deploy --prod --dir .
    exit 0
fi

# ─────────────────────────────────────────────────────────────
# Option C: Vercel CLI
# ─────────────────────────────────────────────────────────────
if command -v vercel &>/dev/null; then
    echo "Vercel CLI found. Deploying..."
    vercel --prod
    exit 0
fi

# ─────────────────────────────────────────────────────────────
# No tool found — print manual instructions
# ─────────────────────────────────────────────────────────────
echo "No deployment tool found automatically. Pick one of the options below:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OPTION 1 — GitHub Pages (free, recommended)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  1. Make sure this repo is pushed to GitHub:"
echo "       git push -u origin master"
echo "  2. On GitHub: Settings → Pages"
echo "  3. Source: Deploy from a branch — branch: master, folder: / (root)"
echo "  4. Click Save — your URL appears in ~2 minutes:"
echo "       https://<your-username>.github.io/<repo-name>/"
echo ""
echo "  To automate this next time, install the GitHub CLI:"
echo "    https://cli.github.com/  then: gh auth login  then re-run deploy.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OPTION 2 — Netlify drag-and-drop (no login required)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  1. Go to: https://app.netlify.com/drop"
echo "  2. Drag this project folder onto the page"
echo "  3. Get an instant public URL — shareable immediately"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OPTION 3 — Vercel CLI"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  1. Run:  npx vercel"
echo "  2. Follow the prompts (creates a free account if needed)"
echo "  3. Re-deploy any time:  npx vercel --prod"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OPTION 4 — itch.io (best for sharing as a game)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  1. Zip this entire project folder"
echo "  2. Go to: https://itch.io/games/new"
echo "  3. Kind of project: HTML — upload the zip"
echo "  4. Under Embed options, enable SharedArrayBuffer if prompted"
echo "  5. Publish (free tier available)"
echo ""

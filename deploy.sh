#!/usr/bin/env bash
# Deploy Battle Hunter to the internet.
# Tries automated options first; if none succeed, builds the itch.io zip
# and walks through every remaining manual step.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Battle Hunter Deploy ==="
echo ""

# Push latest commits so every deploy path is current.
echo "Pushing latest commits..."
git push 2>/dev/null || echo "(Nothing new to push.)"
echo ""

# ── Option A: GitHub Pages via gh CLI ──────────────────────────────────────
if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null 2>&1; then
        REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
        if [[ -n "$REPO" ]]; then
            echo "GitHub repo: $REPO"

            PAGES_URL=$(gh api "repos/$REPO/pages" -q .html_url 2>/dev/null || true)
            if [[ -n "$PAGES_URL" ]]; then
                echo "GitHub Pages already enabled."
                echo "Live at: $PAGES_URL"
                echo "(Changes just pushed will appear within 1-2 minutes.)"
                exit 0
            fi

            BRANCH=$(git branch --show-current)
            if gh api "repos/$REPO/pages" -X POST \
                   -F "source[branch]=$BRANCH" -F "source[path]=/" &>/dev/null 2>&1; then
                sleep 2
                PAGES_URL=$(gh api "repos/$REPO/pages" -q .html_url 2>/dev/null || true)
                echo "GitHub Pages enabled!"
                [[ -n "$PAGES_URL" ]] && echo "Live at: $PAGES_URL"
                echo "(May take 1-2 minutes to appear.)"
                exit 0
            else
                VISIBILITY=$(gh repo view --json visibility -q .visibility 2>/dev/null || true)
                if [[ "$VISIBILITY" == "PRIVATE" ]]; then
                    echo "  GitHub Pages needs a public repo (or paid plan)."
                    echo "  To make it public and retry:"
                    echo "    gh repo edit --visibility public && ./deploy.sh"
                    echo ""
                else
                    echo "  Could not enable GitHub Pages automatically."
                    echo ""
                fi
            fi
        fi
    else
        echo "gh CLI found but not authenticated."
        echo "  Run: gh auth login   then re-run this script."
        echo ""
    fi
fi

# ── Option B: Netlify CLI ───────────────────────────────────────────────────
if command -v netlify &>/dev/null; then
    echo "Netlify CLI found. Deploying..."
    netlify deploy --prod --dir .
    exit 0
fi

# ── Option C: Vercel CLI ────────────────────────────────────────────────────
if command -v vercel &>/dev/null; then
    echo "Vercel CLI found. Deploying..."
    vercel --prod
    exit 0
fi

# ── Option D: itch.io — build zip + guided walkthrough ─────────────────────
echo "No automated deployer available. Building itch.io upload package..."
echo ""

ZIP_DEST="$HOME/Desktop/battle-hunter-web.zip"
rm -f "$ZIP_DEST"

if command -v zip &>/dev/null; then
    zip -r "$ZIP_DEST" index.html style.css manifest.webmanifest icon.svg src/ \
        -x "*.DS_Store" -x "*/.git/*" > /dev/null
elif command -v python3 &>/dev/null; then
    python3 - "$ZIP_DEST" <<'PYEOF'
import sys, zipfile, pathlib
dest = sys.argv[1]
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ('index.html', 'style.css', 'manifest.webmanifest', 'icon.svg'):
        z.write(name)
    for p in pathlib.Path('src').rglob('*'):
        if p.is_file():
            z.write(p)
PYEOF
else
    echo "ERROR: Need 'zip' or 'python3' to build the upload package."
    echo "Install either tool and re-run, or zip index.html style.css src/ manually."
    exit 1
fi

ZIP_KB=$(du -k "$ZIP_DEST" | cut -f1)
echo "  Created: $ZIP_DEST  (${ZIP_KB} KB)"
echo ""

# Open itch.io in the default browser (best-effort).
ITCHIO_NEW="https://itch.io/game/new"
if command -v xdg-open &>/dev/null; then
    xdg-open "$ITCHIO_NEW" 2>/dev/null &
elif command -v open &>/dev/null; then
    open "$ITCHIO_NEW" 2>/dev/null &
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "ITCH.IO UPLOAD  (your browser should have opened https://itch.io/game/new)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  If you don't have an itch.io account yet:"
echo "    https://itch.io/register  (free, takes ~1 minute)"
echo ""
echo "  1. Go to:  $ITCHIO_NEW"
echo ""
echo "  2. Fill in the top of the form:"
echo "       Title:             Battle Hunter"
echo "       Kind of project:   HTML"
echo "       Classification:    Games"
echo ""
echo "  3. Under 'Uploads', click 'Upload files' and select:"
echo "       $ZIP_DEST"
echo "     Then check:  [x] This file will be played in the browser"
echo ""
echo "  4. Under 'Embed options' set:"
echo "       Viewport width:   960"
echo "       Viewport height:  720"
echo "     Uncheck 'Mobile friendly' (this is a desktop game)"
echo ""
echo "  5. Set Visibility to:"
echo "       Public     — anyone can find and play it"
echo "       Restricted — only people with your link can play"
echo ""
echo "  6. Click 'Save & view page'"
echo "     URL: https://<your-username>.itch.io/battle-hunter"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "UPDATING AN EXISTING PAGE (re-deploy after changes):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Re-run this script — it will rebuild the zip."
echo "  2. On itch.io: Edit page → Uploads → delete old zip → upload new zip."
echo "     Tick 'This file will be played in the browser' again."
echo "  3. Save. The live page updates immediately."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "ALTERNATIVE: Netlify drag-and-drop (instant, no game-specific account)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Go to: https://app.netlify.com/drop"
echo "  2. Drag the battle-hunter project folder onto the page"
echo "  3. Instant public URL — no account needed"
echo ""

@echo off
setlocal enabledelayedexpansion

echo === Battle Hunter Deploy ===
echo.

rem No build step: pure static site -- deploy source directly.

rem -----------------------------------------------------------------
rem Option A: GitHub Pages via gh CLI (fully automated)
rem -----------------------------------------------------------------
where gh >nul 2>&1
if not errorlevel 1 (
    gh auth status >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%R in ('gh repo view --json nameWithOwner -q .nameWithOwner 2^>nul') do set REPO=%%R
        if not "!REPO!"=="" (
            echo GitHub repo: !REPO!

            rem Push latest commits so the live site is current.
            echo Pushing latest commits...
            git push 2>nul || echo (Nothing new to push.)

            rem Check if Pages is already enabled.
            for /f "delims=" %%U in ('gh api repos/!REPO!/pages -q .html_url 2^>nul') do set PAGES_URL=%%U
            if not "!PAGES_URL!"=="" (
                echo.
                echo GitHub Pages is already enabled.
                echo Your game is live at: !PAGES_URL!
                echo (Changes just pushed will appear within 1-2 minutes.)
                goto :done
            )

            rem Enable Pages for the first time.
            echo Enabling GitHub Pages...
            for /f "delims=" %%B in ('git branch --show-current') do set BRANCH=%%B
            gh api repos/!REPO!/pages -X POST -F "source[branch]=!BRANCH!" -F "source[path]=/" >nul 2>&1
            if not errorlevel 1 (
                timeout /t 2 /nobreak >nul
                for /f "delims=" %%U in ('gh api repos/!REPO!/pages -q .html_url 2^>nul') do set PAGES_URL=%%U
                echo.
                echo GitHub Pages enabled!
                if not "!PAGES_URL!"=="" echo Your game will be live at: !PAGES_URL!
                echo (It may take 1-2 minutes to appear.)
                goto :done
            ) else (
                echo Could not enable Pages automatically (repo may be private or org-restricted).
                echo.
            )
        )
    ) else (
        echo gh CLI found but not authenticated -- run: gh auth login
        echo.
    )
)

rem -----------------------------------------------------------------
rem Option B: Netlify CLI
rem -----------------------------------------------------------------
where netlify >nul 2>&1
if not errorlevel 1 (
    echo Netlify CLI found. Deploying...
    netlify deploy --prod --dir .
    goto :done
)

rem -----------------------------------------------------------------
rem Option C: Vercel CLI
rem -----------------------------------------------------------------
where vercel >nul 2>&1
if not errorlevel 1 (
    echo Vercel CLI found. Deploying...
    vercel --prod
    goto :done
)

rem -----------------------------------------------------------------
rem No tool found -- print manual instructions
rem -----------------------------------------------------------------
echo No deployment tool found automatically. Pick one of the options below:
echo.
echo ==================================================================
echo OPTION 1 -- GitHub Pages (free, recommended)
echo ==================================================================
echo   1. Make sure this repo is pushed to GitHub:
echo        git push -u origin master
echo   2. On GitHub: Settings -^> Pages
echo   3. Source: Deploy from a branch -- branch: master, folder: / (root)
echo   4. Click Save -- your URL appears in ~2 minutes:
echo        https://^<your-username^>.github.io/^<repo-name^>/
echo.
echo   To automate this next time, install the GitHub CLI:
echo     https://cli.github.com/  then: gh auth login  then re-run deploy.bat
echo.
echo ==================================================================
echo OPTION 2 -- Netlify drag-and-drop (no login required)
echo ==================================================================
echo   1. Go to: https://app.netlify.com/drop
echo   2. Drag this project folder onto the page
echo   3. Get an instant public URL -- shareable immediately
echo.
echo ==================================================================
echo OPTION 3 -- Vercel CLI
echo ==================================================================
echo   1. Run:  npx vercel
echo   2. Follow the prompts (creates a free account if needed)
echo   3. Re-deploy any time:  npx vercel --prod
echo.
echo ==================================================================
echo OPTION 4 -- itch.io (best for sharing as a game)
echo ==================================================================
echo   1. Zip this entire project folder
echo   2. Go to: https://itch.io/games/new
echo   3. Kind of project: HTML -- upload the zip
echo   4. Under Embed options, enable SharedArrayBuffer if prompted
echo   5. Publish (free tier available)
echo.

:done
echo.
pause

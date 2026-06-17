@echo off
setlocal enabledelayedexpansion

echo === Battle Hunter Deploy ===
echo.

rem Push latest commits so every deploy path is current.
echo Pushing latest commits...
git push 2>nul || echo (Nothing new to push.)
echo.

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

            for /f "delims=" %%U in ('gh api repos/!REPO!/pages -q .html_url 2^>nul') do set PAGES_URL=%%U
            if not "!PAGES_URL!"=="" (
                echo GitHub Pages already enabled.
                echo Live at: !PAGES_URL!
                echo (Changes just pushed will appear within 1-2 minutes.)
                goto :done
            )

            for /f "delims=" %%B in ('git branch --show-current') do set BRANCH=%%B
            gh api repos/!REPO!/pages -X POST -F "source[branch]=!BRANCH!" -F "source[path]=/" >nul 2>&1
            if not errorlevel 1 (
                timeout /t 2 /nobreak >nul
                for /f "delims=" %%U in ('gh api repos/!REPO!/pages -q .html_url 2^>nul') do set PAGES_URL=%%U
                echo GitHub Pages enabled!
                if not "!PAGES_URL!"=="" echo Live at: !PAGES_URL!
                echo (May take 1-2 minutes to appear.)
                goto :done
            ) else (
                for /f "delims=" %%V in ('gh repo view --json visibility -q .visibility 2^>nul') do set VIS=%%V
                if "!VIS!"=="PRIVATE" (
                    echo   GitHub Pages needs a public repo ^(or paid plan^).
                    echo   To make it public and retry:
                    echo     gh repo edit --visibility public
                    echo     then re-run deploy.bat
                ) else (
                    echo   Could not enable GitHub Pages automatically.
                )
                echo.
            )
        )
    ) else (
        echo gh CLI found but not authenticated.
        echo   Run: gh auth login   then re-run this script.
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
rem Option D: itch.io -- build zip + guided walkthrough
rem -----------------------------------------------------------------
echo No automated deployer available. Building itch.io upload package...
echo.

set ZIP_DEST=%USERPROFILE%\Desktop\battle-hunter-web.zip
if exist "!ZIP_DEST!" del /f "!ZIP_DEST!"

powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "$zip = [System.IO.Compression.ZipFile]::Open('%ZIP_DEST%', 'Create');" ^
  "foreach ($name in @('index.html','style.css')) {" ^
  "  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-Path $name).Path, $name, 'Optimal') | Out-Null" ^
  "};" ^
  "Get-ChildItem -Path 'src' -Recurse -File | ForEach-Object {" ^
  "  $rel = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace('\','/');" ^
  "  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal') | Out-Null" ^
  "};" ^
  "$zip.Dispose();" ^
  "$kb = [math]::Round((Get-Item '%ZIP_DEST%').Length / 1KB, 0);" ^
  "Write-Host \"  Created: %ZIP_DEST%  ($kb KB)\""

if errorlevel 1 (
    echo ERROR: Could not create the zip file. Check that PowerShell is available.
    goto :manual_only
)

rem Open itch.io new-project page in the default browser.
start https://itch.io/game/new

echo.
echo ==================================================================
echo ITCH.IO UPLOAD  ^(your browser should have opened itch.io/game/new^)
echo ==================================================================
echo.
echo   If you don't have an itch.io account yet:
echo     https://itch.io/register  ^(free, takes ~1 minute^)
echo.
echo   1. Go to:  https://itch.io/game/new
echo.
echo   2. Fill in the top of the form:
echo        Title:             Battle Hunter
echo        Kind of project:   HTML
echo        Classification:    Games
echo.
echo   3. Under 'Uploads', click 'Upload files' and select:
echo        !ZIP_DEST!
echo      Then check:  [x] This file will be played in the browser
echo.
echo   4. Under 'Embed options' set:
echo        Viewport width:   960
echo        Viewport height:  720
echo      Uncheck 'Mobile friendly' ^(this is a desktop game^)
echo.
echo   5. Set Visibility to:
echo        Public     -- anyone can find and play it
echo        Restricted -- only people with your link can play
echo.
echo   6. Click 'Save ^& view page'
echo      URL: https://^<your-username^>.itch.io/battle-hunter
echo.
echo ==================================================================
echo UPDATING AN EXISTING PAGE ^(re-deploy after changes^):
echo ==================================================================
echo.
echo   1. Re-run this script -- it will rebuild the zip.
echo   2. On itch.io: Edit page ^-^> Uploads ^-^> delete old zip ^-^> upload new zip.
echo      Tick 'This file will be played in the browser' again.
echo   3. Save. The live page updates immediately.
echo.
echo ==================================================================
echo ALTERNATIVE: Netlify drag-and-drop ^(instant, no game-specific account^)
echo ==================================================================
echo.
echo   1. Go to: https://app.netlify.com/drop
echo   2. Drag the battle-hunter project folder onto the page
echo   3. Instant public URL -- no account needed
echo.
goto :done

:manual_only
echo.
echo Could not build the zip automatically. Create it manually:
echo   Zip the files: index.html  style.css  src\
echo   Then follow the itch.io steps above.
echo.

:done
echo.
pause

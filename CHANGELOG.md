## Changelog
Initial app.

## Installation Instructions (macOS)

Thank you for downloading **Vox**!

Because this app is open-source and not distributed through the Mac App Store or signed with an Apple Developer ID (to avoid subscription fees), macOS Gatekeeper may show some warnings when you first try to open it. Here's how to install and run **Vox**:

1.  **Download:**
    Download the `vox-{version}.dmg` file from the Assets section below.

2.  **Install:**
    *   Open the downloaded `.dmg` file.
    *   Drag the **Vox.app** icon into your **Applications** folder.
    *   You can now eject the mounted disk image.

3.  **First Run - Bypassing Gatekeeper:**

    *   **"Vox.app is damaged and can’t be opened. You should move it to the Trash."**
        This message can be misleading; the app is very likely **NOT** damaged. It's a stricter Gatekeeper response for unsigned apps downloaded from the internet. To fix this:
        1.  Ensure **Vox.app** is in your **Applications** folder.
        2.  Open **Terminal**. (You can find it via Spotlight: press `Cmd + Space`, type `Terminal`, and press Enter).
        3.  Copy and paste the following command into Terminal and press Enter:
            ```bash
            sudo xattr -cr /Applications/Vox.app
            ```
        4.  You may be prompted for your macOS user password. Type it and press Enter.
        5.  After running the command, try opening **Vox.app** again. It should now open normally.

**Why these steps?**
macOS Gatekeeper is designed to protect users. Since this app isn't notarized by Apple (which requires a paid developer subscription), Gatekeeper flags it. The steps above tell macOS that you trust this application.
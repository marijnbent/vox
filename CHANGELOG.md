## Installation Instructions (macOS)

Thank you for downloading **Vox**!

Because this app is open-source and not distributed through the Mac App Store or signed with an Apple Developer ID (to avoid subscription fees), macOS Gatekeeper may show some warnings when you first try to open it. Here's how to install and run **Vox**:

1.  **Download:**
    Download the `vox-{version}.dmg` (e.g., `vox-1.0.0.dmg`, or specific architecture like `vox-1.0.0-arm64.dmg`) file from the Assets section below.

2.  **Install:**
    *   Open the downloaded `.dmg` file.
    *   Drag the **Vox.app** icon into your **Applications** folder.
    *   You can now eject the mounted disk image.

3.  **First Run - Bypassing Gatekeeper:**

    *   **Scenario 1: "Vox.app can’t be opened because it is from an unidentified developer."**
        This is the most common warning. To bypass it:
        1.  Right-click (or Control-click) on **Vox.app** in your Applications folder.
        2.  Select **"Open"** from the context menu.
        3.  A dialog will appear. Click the **"Open"** button again.
        You only need to do this once. Subsequent launches should open normally.

    *   **Scenario 2: "Vox.app is damaged and can’t be opened. You should move it to the Trash."**
        This message can be misleading; the app is very likely **NOT** damaged. It's a stricter Gatekeeper response for unsigned apps downloaded from the internet. To fix this:
        1.  Ensure **Vox.app** is in your **Applications** folder.
        2.  Open **Terminal**. (You can find it via Spotlight: press `Cmd + Space`, type `Terminal`, and press Enter).
        3.  Copy and paste the following command into Terminal and press Enter:
            ```bash
            sudo xattr -cr /Applications/Vox.app
            ```
        4.  You may be prompted for your macOS user password. Type it (characters won't show) and press Enter.
        5.  After running the command, try opening **Vox.app** again. It should now open normally, or at worst, show the "unidentified developer" warning from Scenario 1, which you can bypass as described above.

**Why these steps?**
macOS Gatekeeper is designed to protect users. Since this app isn't notarized by Apple (which requires a paid developer subscription), Gatekeeper flags it. The steps above tell macOS that you trust this application.
# ComfyUI Web Fetch Node

This custom node allows ComfyUI to interact with a web page open in your system browser. It can input a prompt, upload an image, click a generate button, and fetch the resulting image.

## Installation

1.  Open a terminal in this directory (`custom_nodes/ComfyUI-WebFetch`).
2.  Run `pip install -r requirements.txt`. (Note: If using a portable ComfyUI, ensure you use the `python_embeded` pip).

## Usage

### Option 1: Chrome or Edge (Recommended - Attach to Existing)

1.  **Start your Browser with Remote Debugging:**
    You must start Chrome or Edge from the command line with a debugging port open.
    
    *   **Windows (Chrome):**
        ```bash
        "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
        ```
    *   **Windows (Edge):**
        ```bash
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
        ```
    
    **Important:** Make sure all other instances of the browser are closed before running this command!

2.  **Open the Target Website** in the browser you just launched.
    
3.  **In ComfyUI:**
    *   Select **browser_type**: "Chrome/Edge (Attach)".
    *   **tab_index**: Select which tab to use.

### Option 2: Firefox (Launch New Window)

*Note: Attaching to an *already running* standard Firefox instance is difficult with Selenium. This mode launches a NEW controlled Firefox window.*

1.  **Prerequisites**:
    *   Download [geckodriver](https://github.com/mozilla/geckodriver/releases) and place it in your system PATH or the ComfyUI python scripts folder.
    *   Or install via pip if possible (though binary is usually needed).

2.  **In ComfyUI**:
    *   Select **browser_type**: "Firefox (New Window)".
    *   **firefox_profile_path** (Optional): Path to your Firefox profile directory (e.g., `C:\Users\YourName\AppData\Roaming\Mozilla\Firefox\Profiles\xxxx.default-release`). Use this to keep your login sessions/cookies.
        *   *Warning*: If Firefox is already running with this profile, it might fail. You generally need to close your standard Firefox first.


### Option 3: Userscript (Any Browser - Recommended for Stability)

This method involves NO specialized drivers and works with **any browser** including Safari, Opera, etc., provided you use an extension like Tampermonkey.

1.  **Install Userscript Extension**:
    *   Install **Tampermonkey** (or Greasemonkey / Violetmonkey) for your browser.

2.  **Install the Bridge Script**:
    *   Create a new script in Tampermonkey.
    *   Copy the contents of `web_fetch_userscript.js` (found in this node's folder) and paste it into the editor.
    *   Save the script.

3.  **Usage**:
    *   Open your AI generation website (e.g., `chatgpt.com` or others).
    *   **Enable the Bridge**: Click the Tampermonkey extension icon -> Select **"ComfyUI Web Fetch Bridge"** -> Click **"🟢 Enable Bridge on this Site"**.
    *   The page will reload and you should see a small overlay in the top-right: **"ComfyUI Bridge: Connected (Idle)"**.
    *   In ComfyUI, use the **WebFetch Server** node.
    *   Sends the prompt. The website in your browser will automatically type and click generate.
    *   Once the image appears, it will be sent back to ComfyUI automatically.


## Auto-Detection Logic



## Auto-Detection Logic

The node attempts to automatically find:
*   **Prompt Input**: Large textareas or inputs with "prompt" in their name.
*   **Image Upload**: `input[type="file"]` elements.
*   **Submit Button**: Buttons labeled "Generate", "Run", "Submit", "Create", etc.
*   **Result Image**: Wait for a NEW image to appear on the page or an existing one to update.

If auto-detection fails, inspect the webpage (F12) to find specific CSS selectors and enter them in the node's optional fields.

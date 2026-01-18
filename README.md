# ComfyUI Web Bridge

This custom node allows ComfyUI to interact with ANY website open in your browser via a lightweight Userscript bridge. It acts as a "glue" between ComfyUI and your browser.

## Features
*   **Universal**: Works with Chrome, Firefox, Edge, Safari, Brave, etc.
*   **No Drivers**: No Selenium/GeckoDriver installation required.
*   **Simple**: Just install a browser extension and a script.
*   **Robust**: Uses `GM_xmlhttpRequest` to bypass CORS and Mixed Content issues.

## Installation

1.  **Install Requirements** (Standard ComfyUI usually has these):
    ```bash
    pip install -r requirements.txt
    ```

2.  **Browser Setup**:
    *   Install the **Tampermonkey** extension for your browser.
    *   Create a new script in Tampermonkey.
    *   Copy the content of `web_fetch_userscript.js` (included in this folder) and paste it into the script editor.
    *   Save the script.

## Usage

1.  **In ComfyUI**:
    *   Add the **Web Bridge (Userscript)** node.
    *   Connect your prompt string to the `prompt` input.
    *   (Optional) Adjust `timeout` or providing custom `selector_override_json` if needed.
    *   Queue the prompt. The node will wait (showing "Waiting for browser...").

2.  **In Your Browser**:
    *   Open the target AI generation website (e.g., ChatGPT, Gemini, Midjourney Web).
    *   **Enable the Bridge**:
        *   Click the Tampermonkey icon.
        *   Select "ComfyUI Web Fetch Bridge".
        *   Click **"🟢 Enable Bridge on this Site"**.
    *   The page will reload. You should see an overlay: **"ComfyUI Bridge: Connected (Idle)"**.

3.  **Automation**:
    *   When ComfyUI sends the job, the script will automatically:
        1.  Find the text box and type the prompt.
        2.  Click the Generate/Send button.
        3.  Wait for a new image to appear.
        4.  Send the result image back to ComfyUI.

## Selectors (Optional)

The script uses smart heuristics to find input boxes and buttons. If it fails on a specific specific site, you can pass a JSON string to `selector_override_json` in the node:

```json
{
  "prompt": "#specific-textarea-id",
  "submit": ".send-button-class"
}
```

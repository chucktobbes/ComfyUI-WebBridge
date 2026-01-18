// ==UserScript==
// @name         ComfyUI Web Fetch Bridge
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Connects any website to ComfyUI WebFetch Node
// @author       You
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';

    const SERVER_URL = "http://127.0.0.1:9955";
    const STORAGE_KEY = 'comfyui_bridge_enabled';
    let isProcessing = false;
    let ui = null;
    let loopId = null;

    // --- MENU COMMANDS ---
    // Toggle functionality per domain
    const isEnabled = localStorage.getItem(STORAGE_KEY) === 'true';

    if (isEnabled) {
        GM_registerMenuCommand("🔴 Disable Bridge on this Site", () => {
            if (confirm("Disable ComfyUI Bridge for this site?")) {
                localStorage.removeItem(STORAGE_KEY);
                location.reload();
            }
        });
        startBridge();
    } else {
        GM_registerMenuCommand("🟢 Enable Bridge on this Site", () => {
            localStorage.setItem(STORAGE_KEY, 'true');
            location.reload();
        });
        console.log("ComfyUI Bridge is installed but disabled on this site. Use the Tampermonkey menu to enable it.");
    }

    function startBridge() {
        createUI();
        loopId = setInterval(checkJob, 2000); // Check every 2 seconds
    }

    // --- UI HELPER ---
    function createUI() {
        if (ui) return;
        ui = document.createElement('div');
        ui.style.cssText = "position:fixed; top:10px; right:10px; z-index:99999; background:rgba(0,0,0,0.8); color:white; padding:10px; border-radius:5px; font-family:sans-serif; font-size:12px; pointer-events:none; border: 1px solid #444;";
        ui.innerHTML = "ComfyUI Bridge: <span style='color:#FFFF00'>Idle</span>";
        document.body.appendChild(ui);
    }

    function updateStatus(text, color) {
        if (!ui) createUI();
        ui.innerHTML = `ComfyUI Bridge: <span style='color:${color}'>${text}</span>`;
    }

    // --- NETWORK HELPER ---
    function gmRequest(url, method = "GET", data = null) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: method,
                url: url,
                data: data ? JSON.stringify(data) : null,
                headers: { "Content-Type": "application/json" },
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const json = JSON.parse(response.responseText);
                            resolve(json);
                        } catch (e) {
                            resolve(response.responseText); // Fallback for non-json
                        }
                    } else {
                        reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                    }
                },
                onerror: (err) => {
                    reject(new Error("Network Error"));
                },
                ontimeout: () => {
                    reject(new Error("Timeout"));
                }
            });
        });
    }

    // --- MAIN LOOP ---
    async function checkJob() {
        if (isProcessing) return;

        try {
            // Use GM_xmlhttpRequest to bypass CSP/Mixed Content (HTTPS -> HTTP)
            const data = await gmRequest(`${SERVER_URL}/job`);

            if (data.job) {
                isProcessing = true;
                updateStatus("Processing Job...", "#00FF00");
                console.log("ComfyUI Job Received:", data.job);
                await executeJob(data.job);
            } else {
                updateStatus("Connected (Idle)", "#AAAAAA");
            }
        } catch (e) {
            console.warn("ComfyUI Bridge Poll Error:", e);
            updateStatus("Disconnected (Server Unreachable)", "#FF0000");
        }
    }

    async function executeJob(job) {
        try {
            // 1. Find Prompt Box
            let promptBox = findPromptBox(job.selectors);
            if (!promptBox) throw new Error("Prompt box not found");

            // 2. Input Text
            promptBox.focus();
            promptBox.value = job.prompt;
            promptBox.dispatchEvent(new Event('input', { bubbles: true }));

            if (promptBox.isContentEditable) {
                promptBox.innerText = job.prompt;
            }

            // Try to assume specific Gemini/ChatGPT structure handling if needed
            // (e.g. clicking the 'send' icon inside the box)

            await sleep(500);

            // 3. Find & Click Generate
            let btn = findGenerateButton(job.selectors);
            if (!btn) throw new Error("Generate button not found");

            const oldImages = getImgSrcs();

            btn.click();
            updateStatus("Generating...", "#00FFFF");

            // 4. Wait for Result
            let resultSrc = await waitForNewImage(oldImages, job.timeout || 60);

            // 5. Send Result
            updateStatus("Uploading Result...", "#FFFF00");
            await sendResult(resultSrc);

            updateStatus("Done!", "#00FF00");
        } catch (e) {
            console.error(e);
            updateStatus("Error: " + e.message, "#FF0000");
            gmRequest(`${SERVER_URL}/result`, 'POST', { error: e.message }).catch(err => console.error("Failed to report error", err));
        } finally {
            isProcessing = false;
        }
    }

    // --- ACTIONS ---

    function findPromptBox(selectors) {
        if (selectors && selectors.prompt) return document.querySelector(selectors.prompt);

        const candidates = [
            ...document.querySelectorAll('textarea'),
            ...document.querySelectorAll('div[contenteditable="true"]'),
            ...document.querySelectorAll('[role="textbox"]'),
            ...document.querySelectorAll('input[type="text"]'),
        ];

        let best = null;
        let bestScore = -1;

        candidates.forEach(el => {
            if (el.offsetParent === null) return;

            let score = 0;
            const context = (el.id + el.className + el.getAttribute('placeholder') + el.getAttribute('aria-label')).toLowerCase();

            if (context.includes('prompt')) score += 10;
            if (context.includes('chat')) score += 5;
            if (context.includes('ask')) score += 5; // Gemini uses "Ask Gemini"
            if (el.tagName === 'TEXTAREA') score += 2;
            if (el.getAttribute('contenteditable') === 'true') score += 5;

            // Heavily penalize search bars if we have other options
            if (context.includes('search')) score -= 2;

            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        });

        return best;
    }

    function findGenerateButton(selectors) {
        if (selectors && selectors.submit) return document.querySelector(selectors.submit);

        const keywords = ['generate', 'create', 'run', 'submit', 'send', 'dream'];
        const buttons = [...document.querySelectorAll('button'), ...document.querySelectorAll('input[type="submit"]'), ...document.querySelectorAll('div[role="button"]')];

        for (let btn of buttons) {
            if (btn.offsetParent === null) continue;

            // Check Aria Label which is common in modern apps (like Gemini send button)
            const aria = (btn.getAttribute('aria-label') || "").toLowerCase();
            const txt = (btn.innerText + btn.value).toLowerCase();

            if (keywords.some(k => txt.includes(k) || aria.includes(k))) return btn;

            // Special case: Material icons often have no text but specific classes or SVGs
            if (aria.includes('send') || aria.includes('submit')) return btn;
        }
        return null;
    }

    function getImgSrcs() {
        return new Set([...document.images].map(i => i.src));
    }

    async function waitForNewImage(oldImages, timeoutSecs) {
        const start = Date.now();
        while ((Date.now() - start) < timeoutSecs * 1000) {
            const currentImages = [...document.images];
            for (let img of currentImages) {
                // Ignore small icons, avatars (often < 100px)
                if (img.src && !oldImages.has(img.src) && img.naturalWidth > 200 && img.naturalHeight > 200) {
                    return img.src;
                }
            }
            await sleep(1000);
        }
        throw new Error("Timeout waiting for image");
    }

    async function sendResult(src) {
        const dataUrl = await toDataURL(src);
        await gmRequest(`${SERVER_URL}/result`, 'POST', { image: dataUrl });
    }

    // --- UTILS ---
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function toDataURL(url) {
        if (url.startsWith('data:')) return url;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                responseType: "blob",
                onload: (response) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(response.response);
                },
                onerror: reject
            });
        });
    }

})();

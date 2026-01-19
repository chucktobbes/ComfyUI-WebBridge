// ==UserScript==
// @name         ComfyUI Web Fetch Bridge
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Connects any website to ComfyUI WebFetch Node
// @author       You
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';

    const SERVER_URL = "http://127.0.0.1:9955";
    // --- MENU COMMANDS ---
    const ENABLED_KEY = 'comfyui_bridge_enabled';
    const isEnabled = localStorage.getItem(ENABLED_KEY) === 'true';

    // Config Storage Keys (Per Site)
    const HOST = window.location.hostname;
    const CFG_PROMPT = `cfg_${HOST}_prompt`;
    const CFG_BTN = `cfg_${HOST}_btn`;
    const CFG_TEXT_OUTPUT = `cfg_${HOST}_text_output`;
    const CFG_UPLOAD = `cfg_${HOST}_upload_target`;

    let isProcessing = false;
    let ui = null;
    let uiPanel = null;
    let selectionMode = null;
    let lastHovered = null;

    if (isEnabled) {
        GM_registerMenuCommand("🔴 Disable Bridge on this Site", () => {
            if (confirm("Disable ComfyUI Bridge for this site?")) {
                localStorage.removeItem(ENABLED_KEY);
                location.reload();
            }
        });
        startBridge();
    } else {
        GM_registerMenuCommand("🟢 Enable Bridge on this Site", () => {
            localStorage.setItem(ENABLED_KEY, 'true');
            location.reload();
        });
        console.log("ComfyUI Bridge is installed but disabled by default. Use the Tampermonkey menu to enable it for this site.");
        return;
    }

    function startBridge() {
        createUI();
        setInterval(checkJob, 2000);
    }

    // --- UI HELPER ---
    function createUI() {
        if (ui) return;

        // Container
        ui = document.createElement('div');
        ui.style.cssText = "position:fixed; top:10px; right:10px; z-index:999999; font-family:sans-serif; font-size:12px; pointer-events:auto;";

        // Status Bar
        const statusBar = document.createElement('div');
        statusBar.style.cssText = "background:rgba(0,0,0,0.85); color:white; padding:8px 12px; border-radius:6px; border: 1px solid #444; display:flex; align-items:center; gap:10px; cursor:default; box-shadow:0 4px 6px rgba(0,0,0,0.3);";

        const statusText = document.createElement('span');
        statusText.innerHTML = "ComfyUI: <span id='c-status' style='color:#AAAAAA; font-weight:bold;'>Idle</span>";

        const settingsBtn = document.createElement('div');
        settingsBtn.innerText = "⚙️";
        settingsBtn.style.cssText = "cursor:pointer; opacity:0.7; font-size:14px;";
        settingsBtn.onclick = toggleSettings;
        settingsBtn.onmouseover = () => settingsBtn.style.opacity = '1';
        settingsBtn.onmouseout = () => settingsBtn.style.opacity = '0.7';

        statusBar.appendChild(statusText);
        statusBar.appendChild(settingsBtn);
        ui.appendChild(statusBar);

        // Settings Panel
        uiPanel = document.createElement('div');
        uiPanel.style.cssText = "display:none; margin-top:5px; background:rgba(0,0,0,0.9); padding:10px; border-radius:6px; border:1px solid #555; color:#eee; min-width:220px; flex-direction:column; gap:8px;";

        // Helper to create rows
        const createRow = (label, key, type) => {
            const row = document.createElement('div');
            row.style.cssText = "display:flex; flex-direction:column; gap:4px;";

            const lbl = document.createElement('div');
            lbl.innerText = label;
            lbl.style.color = '#ccc';
            lbl.style.fontSize = '10px';

            const controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.gap = '5px';

            const selBtn = document.createElement('button');
            selBtn.innerText = "🎯 Select";
            selBtn.style.cssText = "flex:1; background:#333; border:1px solid #555; color:white; border-radius:3px; cursor:pointer;";
            selBtn.onclick = () => startSelection(type);

            const clearBtn = document.createElement('button');
            clearBtn.innerText = "❌";
            clearBtn.title = "Reset to Auto";
            clearBtn.style.cssText = "background:#333; border:1px solid #555; color:white; border-radius:3px; cursor:pointer;";
            clearBtn.onclick = () => {
                GM_deleteValue(key);
                updatePanel();
            };

            controls.appendChild(selBtn);
            controls.appendChild(clearBtn);

            const valDisplay = document.createElement('div');
            valDisplay.id = `c-val-${type}`;
            valDisplay.style.cssText = "font-size:9px; color:#666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;";
            valDisplay.innerText = "Auto";

            row.appendChild(lbl);
            row.appendChild(controls);
            row.appendChild(valDisplay);
            return row;
        };

        uiPanel.appendChild(createRow("Prompt Input", CFG_PROMPT, 'prompt'));
        uiPanel.appendChild(createRow("Generate Button", CFG_BTN, 'button'));
        uiPanel.appendChild(createRow("Text Output Area", CFG_TEXT_OUTPUT, 'text'));
        uiPanel.appendChild(createRow("Image Upload Target", CFG_UPLOAD, 'upload'));

        // Close / Help
        const footer = document.createElement('div');
        footer.style.cssText = "margin-top:5px; border-top:1px solid #444; padding-top:5px; font-size:10px; color:#888; text-align:center;";
        footer.innerText = "Click 'Select' then click the element on page.";
        uiPanel.appendChild(footer);

        ui.appendChild(uiPanel);
        document.body.appendChild(ui);

        updatePanel();
    }

    function toggleSettings() {
        if (!uiPanel) return;
        uiPanel.style.display = uiPanel.style.display === 'none' ? 'flex' : 'none';
        if (uiPanel.style.display === 'flex') updatePanel();
    }

    function updatePanel() {
        const pVal = GM_getValue(CFG_PROMPT);
        const bVal = GM_getValue(CFG_BTN);
        const tVal = GM_getValue(CFG_TEXT_OUTPUT);
        const uVal = GM_getValue(CFG_UPLOAD);

        const updateLbl = (type, val) => {
            const el = document.getElementById(`c-val-${type}`);
            if (el) {
                el.innerText = val ? val : "Auto Detected";
                el.style.color = val ? "#4CAF50" : "#666";
            }
        };

        updateLbl('prompt', pVal);
        updateLbl('button', bVal);
        updateLbl('text', tVal);
        updateLbl('upload', uVal);
    }

    function updateStatus(text, color) {
        const el = document.getElementById('c-status');
        if (el) {
            el.innerHTML = text;
            el.style.color = color;
        }
    }

    // --- SELECTION LOGIC ---
    function startSelection(type) {
        if (selectionMode) stopSelection();
        selectionMode = type;

        let label = "Element";
        if (type === 'prompt') label = "Input Box";
        if (type === 'button') label = "Generate Button";
        if (type === 'text') label = "Text Output Container";
        if (type === 'upload') label = "Upload Drop Zone / Button";

        updateStatus(`Select ${label}...`, "#00BFFF");

        // Overlay styles
        const style = document.createElement('style');
        style.id = 'comfy-selection-style';
        style.innerHTML = `* { cursor: crosshair !important; } .comfy-highlight { outline: 3px solid #ff00ff !important; box-shadow: 0 0 10px #ff00ff !important; }`;
        document.head.appendChild(style);

        document.addEventListener('mouseover', onHover, true);
        document.addEventListener('click', onSelect, true);
        document.addEventListener('keydown', onKey, true);
    }

    function stopSelection() {
        selectionMode = null;
        const style = document.getElementById('comfy-selection-style');
        if (style) style.remove();

        if (lastHovered) {
            lastHovered.classList.remove('comfy-highlight');
            lastHovered = null;
        }

        document.removeEventListener('mouseover', onHover, true);
        document.removeEventListener('click', onSelect, true);
        document.removeEventListener('keydown', onKey, true);

        updateStatus("Idle", "#AAAAAA");
    }

    function onHover(e) {
        if (!selectionMode) return;
        if (ui && ui.contains(e.target)) return; // Don't select UI

        e.preventDefault();
        e.stopPropagation();

        if (lastHovered !== e.target) {
            if (lastHovered) lastHovered.classList.remove('comfy-highlight');
            lastHovered = e.target;
            lastHovered.classList.add('comfy-highlight');
        }
    }

    function onSelect(e) {
        if (!selectionMode) return;
        if (ui && ui.contains(e.target)) return;

        e.preventDefault();
        e.stopPropagation();

        const selector = generateSelector(e.target);

        let key;
        if (selectionMode === 'prompt') key = CFG_PROMPT;
        else if (selectionMode === 'button') key = CFG_BTN;
        else if (selectionMode === 'text') key = CFG_TEXT_OUTPUT;
        else if (selectionMode === 'upload') key = CFG_UPLOAD;

        GM_setValue(key, selector);
        console.log(`[ComfyBridge] Saved selector for ${selectionMode}:`, selector);

        // Visual confirmation
        updateStatus("Saved!", "#00FF00");
        stopSelection();
        toggleSettings(); // Open settings to show result
    }

    function onKey(e) {
        if (e.key === 'Escape') {
            stopSelection();
        }
    }

    function generateSelector(el) {
        if (el.id) return `#${el.id}`;

        let path = [];
        while (el.parentElement) {
            let tag = el.tagName.toLowerCase();
            if (el === document.body) {
                path.unshift('body');
                break;
            }

            let sibling = el;
            let nth = 1;
            while (sibling = sibling.previousElementSibling) {
                if (sibling.tagName.toLowerCase() === tag) nth++;
            }

            if (nth > 1) tag += `:nth-of-type(${nth})`;
            path.unshift(tag);
            el = el.parentElement;
        }
        return path.join(' > ');
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
                            resolve(response.responseText);
                        }
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: (err) => { reject(new Error("Network Error")); },
                ontimeout: () => { reject(new Error("Timeout")); }
            });
        });
    }

    // --- MAIN LOOP ---
    async function checkJob() {
        if (isProcessing) return;

        try {
            const data = await gmRequest(`${SERVER_URL}/job`);

            if (data.job) {
                isProcessing = true;
                await executeJob(data.job);
            } else {
                if (selectionMode === null) updateStatus("Connected (Idle)", "#AAAAAA");
                if (GM_getValue('comfy_job_id')) {
                    GM_deleteValue('comfy_job_id');
                    GM_deleteValue('comfy_job_phase');
                }
            }
        } catch (e) {
            updateStatus("Disconnected", "#FF4444");
        }
    }

    async function executeJob(job) {
        const storedId = GM_getValue('comfy_job_id') || (window.name.startsWith('comfy_job:') ? window.name.split(':')[1] : null);
        let phase = GM_getValue('comfy_job_phase') || 'start';

        if (storedId === job.id) {
            console.log(`[ComfyBridge] Resuming Job ${job.id} at phase ${phase}`);
            updateStatus(`Resuming (${phase})...`, "#00FF00");
        } else {
            console.log(`[ComfyBridge] Starting New Job ${job.id} (${job.mode})`);
            GM_setValue('comfy_job_id', job.id);
            GM_setValue('comfy_job_phase', 'start');
            try { window.name = `comfy_job:${job.id}`; } catch (e) { }
            phase = 'start';
        }

        try {
            // PHASE 1: INPUT (Image + Prompt)
            if (phase === 'start') {
                updateStatus("Preparing Input...", "#00FFFF");

                // 1.1 Upload Image if present
                if (job.input_image) {
                    updateStatus("Uploading Image...", "#00FFFF");
                    const uploadTarget = findUploadTarget();
                    if (uploadTarget) {
                        await uploadImage(uploadTarget, job.input_image);
                        await sleep(2000); // Wait for upload to process
                    } else {
                        console.warn("[ComfyBridge] No upload target found. Skipping image upload.");
                    }
                }

                // 1.2 Type Prompt
                updateStatus("Type Prompt...", "#00FFFF");
                let promptBox = findPromptBox(job.selectors);
                if (!promptBox) {
                    await sleep(2000);
                    promptBox = findPromptBox(job.selectors);
                }

                if (!promptBox) {
                    console.warn("[ComfyBridge] Prompt box not found. Checking if we should wait for result...");
                    phase = 'wait_result';
                    GM_setValue('comfy_job_phase', phase);
                } else {
                    promptBox.focus();
                    promptBox.value = job.prompt;
                    promptBox.dispatchEvent(new Event('input', { bubbles: true }));
                    if (promptBox.getAttribute('contenteditable') === 'true') {
                        promptBox.innerText = job.prompt;
                        promptBox.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    phase = 'generate';
                    GM_setValue('comfy_job_phase', phase);
                    await sleep(500);
                }
            }

            // PHASE 2: CLICK Generate
            if (phase === 'generate') {
                updateStatus("Click Generate...", "#00FFFF");

                let btn = findGenerateButton(job.selectors);
                if (!btn) {
                    console.warn("[ComfyBridge] Generate button not found.");
                } else {
                    btn.click();
                }

                phase = 'wait_result';
                GM_setValue('comfy_job_phase', phase);
                await sleep(3000);
            }

            // PHASE 3: WAIT Result
            if (phase === 'wait_result') {
                const mode = job.mode || 'image'; // Legacy default

                if (mode === 'text') {
                    updateStatus("Waiting for Text...", "#FFFF00");
                    const text = await waitForText(job.timeout || 60);

                    updateStatus("Uploading Text...", "#00FF00");
                    await gmRequest(`${SERVER_URL}/result`, 'POST', { text: text });

                } else {
                    // IMAGE MODE
                    updateStatus("Waiting for Image...", "#FFFF00");
                    const currentImages = getImgSrcs();

                    let resultSrc = null;
                    try {
                        resultSrc = await waitForNewImage(currentImages, job.timeout || 60);
                    } catch (e) {
                        console.warn("[ComfyBridge] Timeout. Checking robust fallback...");
                        const allImgs = [...document.images].filter(i => i.naturalWidth > 200);
                        if (allImgs.length > 0) resultSrc = allImgs[allImgs.length - 1].src;
                        else throw e;
                    }

                    updateStatus("Uploading Image...", "#00FF00");
                    await sendImageResult(resultSrc);
                }

                GM_deleteValue('comfy_job_id');
                GM_deleteValue('comfy_job_phase');
                updateStatus("Done!", "#00FF00");
            }

        } catch (e) {
            console.error(e);
            updateStatus("Error: " + e.message, "#FF0000");
            await sleep(1000);
            gmRequest(`${SERVER_URL}/result`, 'POST', { error: e.message }).catch(err => { });
            GM_deleteValue('comfy_job_id');
            GM_deleteValue('comfy_job_phase');
        } finally {
            isProcessing = false;
        }
    }

    // --- UPLOAD HELPER ---
    async function uploadImage(target, base64Data) {
        try {
            // Convert base64 to Blob
            const res = await fetch(base64Data);
            const blob = await res.blob();
            const file = new File([blob], "image.png", { type: "image/png" });

            // Create DataTransfer
            const dt = new DataTransfer();
            dt.items.add(file);
            const fileList = dt.files;

            // Method 1: Simulate PASTE (Best for Chat UI)
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
            });
            target.dispatchEvent(pasteEvent);

            // Method 2: Simulate DROP (Best for Dropzones)
            const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt
            });
            target.dispatchEvent(dropEvent);

            // Method 3: If target is input[type=file], we can't set files directly safely,
            // but if the user selected the PARENT label or wrapper, the drop event often propagates.

            console.log("[ComfyBridge] Dispatched Paste/Drop events for image upload.");

        } catch (e) {
            console.error("[ComfyBridge] Upload failed:", e);
        }
    }

    // --- FINDERS ---

    function findUploadTarget() {
        // 1. User Custom
        const custom = GM_getValue(CFG_UPLOAD);
        if (custom) {
            try {
                const el = document.querySelector(custom);
                if (el) return el;
            } catch (e) { console.warn("Invalid custom selection for upload", custom); }
        }

        // 2. Heuristic: Fallback to Prompt Box (Paste usually works there)
        return findPromptBox(null);
    }

    function findPromptBox(serverSelectors) {
        // 1. User Custom
        const custom = GM_getValue(CFG_PROMPT);
        if (custom) {
            try {
                const el = document.querySelector(custom);
                if (el) return el;
            } catch (e) { console.warn("Invalid custom selector", custom); }
        }

        // 2. Server Hint
        if (serverSelectors && serverSelectors.prompt) return document.querySelector(serverSelectors.prompt);

        // 3. Heuristics
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
            if (context.includes('ask')) score += 5;
            if (el.tagName === 'TEXTAREA') score += 2;
            if (el.getAttribute('contenteditable') === 'true') score += 5;
            if (context.includes('search')) score -= 2;

            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        });

        return best;
    }

    function findGenerateButton(serverSelectors) {
        // 1. User Custom
        const custom = GM_getValue(CFG_BTN);
        if (custom) {
            try {
                const el = document.querySelector(custom);
                if (el) return el;
            } catch (e) { console.warn("Invalid custom selector", custom); }
        }

        // 2. Server Hint
        if (serverSelectors && serverSelectors.submit) return document.querySelector(serverSelectors.submit);

        // 3. Heuristics
        const keywords = ['generate', 'create', 'run', 'submit', 'send', 'dream'];
        const buttons = [...document.querySelectorAll('button'), ...document.querySelectorAll('input[type="submit"]'), ...document.querySelectorAll('div[role="button"]')];

        for (let btn of buttons) {
            if (btn.offsetParent === null) continue;
            const aria = (btn.getAttribute('aria-label') || "").toLowerCase();
            const txt = (btn.innerText + btn.value).toLowerCase();

            if (keywords.some(k => txt.includes(k) || aria.includes(k))) return btn;
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
                if (img.src && !oldImages.has(img.src) && img.naturalWidth > 200 && img.naturalHeight > 200) {
                    return img.src;
                }
            }
            await sleep(1000);
        }
        throw new Error("Timeout waiting for image");
    }

    async function waitForText(timeoutSecs) {
        const custom = GM_getValue(CFG_TEXT_OUTPUT);
        let container = custom ? document.querySelector(custom) : document.body;

        if (!container) container = document.body;

        console.log("[ComfyBridge] Waiting for text in:", container);

        let lastText = container.innerText;
        let stableCount = 0;
        const start = Date.now();

        let hasStarted = false;

        while ((Date.now() - start) < timeoutSecs * 1000) {
            const currentText = container.innerText;

            if (currentText.length !== lastText.length) {
                hasStarted = true;
                lastText = currentText;
                stableCount = 0;
            } else {
                if (hasStarted) {
                    stableCount++;
                    if (stableCount >= 4) {
                        return lastText;
                    }
                } else {
                    if ((Date.now() - start) > 5000 && currentText.length > 50) {
                        return currentText;
                    }
                }
            }
            await sleep(500);
        }

        if (hasStarted) return lastText;
        throw new Error("Timeout waiting for text generation");
    }

    // --- UTILS ---
    async function sendImageResult(src) {
        const dataUrl = await toDataURL(src);
        await gmRequest(`${SERVER_URL}/result`, 'POST', { image: dataUrl });
    }

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

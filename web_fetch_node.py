import torch
import numpy as np
from PIL import Image
import os
import time
import tempfile
import logging
import io
import requests
from io import BytesIO

# Try importing selenium, handle missing dependency graceously
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException, NoSuchElementException
except ImportError:
    webdriver = None
    print("Selenium not installed. Please install requirements.txt")

class WebFetchNode:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "browser_type": (["Chrome/Edge (Attach)", "Firefox (New Window)"],),
                "prompt": ("STRING", {"multiline": True, "dynamicPrompts": False}),
                "tab_index": ("INT", {"default": 0, "min": 0, "max": 99}),
            },
            "optional": {
                "image": ("IMAGE",),
                "remote_debugging_port": ("INT", {"default": 9222, "min": 1, "max": 65535}),
                "firefox_profile_path": ("STRING", {"default": "", "multiline": False}),
                "time_limit": ("INT", {"default": 30, "min": 5, "max": 600}),
                "manual_prompt_selector": ("STRING", {"default": ""}),
                "manual_upload_selector": ("STRING", {"default": ""}),
                "manual_submit_selector": ("STRING", {"default": ""}),
                "manual_result_img_selector": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "fetch_from_web"
    CATEGORY = "WebFetch"

    def fetch_from_web(self, browser_type, prompt, tab_index, image=None, remote_debugging_port=9222, firefox_profile_path="", time_limit=30, 
                       manual_prompt_selector="", manual_upload_selector="", manual_submit_selector="", manual_result_img_selector=""):
        
        if webdriver is None:
            raise ImportError("Selenium is not installed. Please install it to use this node.")

        driver = None
        
        # 1. Connect/Launch Browser
        if browser_type == "Chrome/Edge (Attach)":
            chrome_options = Options()
            chrome_options.add_experimental_option("debuggerAddress", f"127.0.0.1:{remote_debugging_port}")
            try:
                driver = webdriver.Chrome(options=chrome_options)
            except Exception as e:
                raise Exception(f"Could not connect to Chrome/Edge at port {remote_debugging_port}. Make sure it is running with '--remote-debugging-port={remote_debugging_port}'. Error: {e}")
        
        elif browser_type == "Firefox (New Window)":
            try:
                from selenium.webdriver.firefox.options import Options as FirefoxOptions
                from selenium.webdriver.firefox.service import Service as FirefoxService
                
                options = FirefoxOptions()
                
                # If a profile is provided, use it to keep login state
                if firefox_profile_path and os.path.exists(firefox_profile_path):
                    options.add_argument("-profile")
                    options.add_argument(firefox_profile_path)
                
                # Note: This launches a NEW instance. Attaching to existing Firefox is difficult.
                # If the user points to an existing profile that is currently in use, Firefox might error 
                # or open a new window sharing the session.
                
                # We assume geckodriver is in path or installed via pip? 
                # Providing a service object is safer if we want to suppress logs etc.
                driver = webdriver.Firefox(options=options)
                
            except Exception as e:
                 raise Exception(f"Failed to launch Firefox. Ensure 'geckodriver' is installed and in your PATH. Error: {e}")

        if not driver:
             raise Exception("Driver initialization failed.")

        try:
            # 2. Switch to Tab
            # For Firefox new window, there might only be one tab effectively, or restored session tabs.
            # We wait a bit for pages to load if it's a fresh launch
            if browser_type == "Firefox (New Window)":
                time.sleep(2) 
            
            handles = driver.window_handles
            if tab_index >= len(handles):
                 # If only 1 tab exists and index is > 0, maybe user wants to open a new tab? 
                 # For now, stick to strict index.
                 if len(handles) == 1 and tab_index == 0:
                     pass # Success
                 else:
                     print(f"Warning: Tab index {tab_index} out of range (Found {len(handles)} tabs). Using current tab.")
            else:
                driver.switch_to.window(handles[tab_index])
            
            print(f"Connected to tab: {driver.title}")

            # ... Rest of execution same as before ... 

        except Exception as e:
            raise Exception(f"Failed to switch to tab {tab_index}: {e}")

        # 3. Handle Image Upload
        if image is not None:
            try:
                # Convert tensor to temporary file
                # image is items, height, width, channel (Check comfy format)
                # Usually [1, H, W, 3]
                
                # Take the first image in the batch
                img_tensor = image[0] 
                i = 255. * img_tensor.cpu().numpy()
                img_pil = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
                
                # Save to temp file
                with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                    img_path = tf.name
                    img_pil.save(img_path)
                
                # Find upload input
                file_input = None
                if manual_upload_selector:
                    file_input = driver.find_element(By.CSS_SELECTOR, manual_upload_selector)
                else:
                    # Heuristic: Find visible input type=file, or just any input type=file
                    file_inputs = driver.find_elements(By.XPATH, "//input[@type='file']")
                    if file_inputs:
                        file_input = file_inputs[0] # Pick first one
                
                if file_input:
                    file_input.send_keys(img_path)
                    print("Uploaded image.")
                    # Give it a moment to process upload if needed
                    time.sleep(1) 
                else:
                    print("Warning: No file input found, skipping image upload.")

            except Exception as e:
                print(f"Error handling image upload: {e}")
            finally:
                # Cleanup temp file? ideally yes, but maybe browser needs it for a bit?
                # Usually send_keys is instant, but let's leave it for OS cleanup or explicit delete if strictly needed.
                # For safety in this script, we won't delete immediately to ensure browser grabbed it.
                pass

        # 4. Handle Prompt
        try:
            prompt_input = None
            if manual_prompt_selector:
                prompt_input = driver.find_element(By.CSS_SELECTOR, manual_prompt_selector)
            else:
                # Heuristics:
                # Priority 1: Textarea with 'prompt' in id, name, or placeholder
                # Priority 2: contenteditable divs (common in modern chat apps)
                # Priority 3: Input[text]
                
                candidates = (
                    driver.find_elements(By.TAG_NAME, "textarea") + 
                    driver.find_elements(By.CSS_SELECTOR, "input[type='text']") +
                    driver.find_elements(By.CSS_SELECTOR, "[contenteditable='true']") +
                    driver.find_elements(By.CSS_SELECTOR, "[role='textbox']")
                )
                
                best_candidate = None
                best_score = -1
                
                unique_candidates = {el._id: el for el in candidates}.values() # Remove dupes
                
                for el in unique_candidates:
                    try:
                        if not el.is_displayed(): continue
                        score = 0
                        
                        # Get attributes for scoring
                        outer_html = el.get_attribute("outerHTML").lower()
                        placeholder = el.get_attribute("placeholder") or ""
                        aria_label = el.get_attribute("aria-label") or ""
                        
                        text_content = (placeholder + aria_label + outer_html).lower()
                        
                        # Keywords
                        if "prompt" in text_content: score += 10
                        if "chat" in text_content: score += 5
                        if "message" in text_content: score += 5
                        if "search" in text_content: score += 2 # Sometimes search bars are prompts
                        
                        # Type boosting
                        tag_name = el.tag_name.lower()
                        if tag_name == "textarea": score += 5
                        if el.get_attribute("contenteditable") == "true": score += 5
                        
                        # Size matters (often the main prompt box is big)
                        size = el.size
                        area = size['width'] * size['height']
                        score += (area / 10000) # Small weight for size
                        
                        if score > best_score:
                            best_score = score
                            best_candidate = el
                    except:
                        continue
                
                prompt_input = best_candidate

            if prompt_input:
                # Clear and send keys
                print(f"Found prompt input: {prompt_input.tag_name} (Score: {best_score})")
                try:
                    prompt_input.click() # Focus helps
                    time.sleep(0.1)
                    prompt_input.clear()
                except:
                    # Clear often fails on contenteditable or complex React inputs
                    # Try Ctrl+A + Del
                    try:
                         # from selenium.webdriver.common.keys import Keys (Need to import Keys if not avail, but we can use unicode or just try simple clear first)
                         pass
                    except:
                        pass
                
                # Check if we need to send keys gracefully
                prompt_input.send_keys(prompt)
                print("Entered prompt.")
            else:
                # Log visible text inputs to help user debug
                debug_msg = "Could not find a prompt input text box. Detected candidates:\n"
                for el in candidates[:5]:
                    try:
                        debug_msg += f"- {el.tag_name} (id={el.get_attribute('id')}, class={el.get_attribute('class')})\n"
                    except: pass
                print(debug_msg)
                raise Exception("Could not find a prompt input text box. Try using 'manual_prompt_selector'.")

        except Exception as e:
            raise Exception(f"Error entering prompt: {e}")

        # 5. Find and Click Submit/Run
        try:
            submit_btn = None
            if manual_submit_selector:
                submit_btn = driver.find_element(By.CSS_SELECTOR, manual_submit_selector)
            else:
                # Heuristics: Button containing specific keywords
                keywords = ["generate", "run", "create", "submit", "dream"]
                buttons = driver.find_elements(By.TAG_NAME, "button")
                
                for btn in buttons:
                    if not btn.is_displayed(): continue
                    txt = btn.text.lower()
                    if any(k in txt for k in keywords):
                        submit_btn = btn
                        break
                
                # If no button tag, check inputs type=submit
                if not submit_btn:
                    inputs = driver.find_elements(By.CSS_SELECTOR, "input[type='submit']")
                    if inputs:
                         # Filter visible
                         for inp in inputs:
                             if inp.is_displayed():
                                 submit_btn = inp
                                 break
            
            if submit_btn:
                # Record existing images state before clicking
                initial_images = self.get_all_image_urls(driver)
                
                submit_btn.click()
                print("Clicked submit.")
                
                # 6. Wait for result
                result_image = self.wait_for_new_image(driver, initial_images, time_limit, manual_result_img_selector)
                
                if result_image:
                    return (self.load_image_from_url(result_image, driver),)
                else:
                    raise Exception("Timed out waiting for new image result.")
            else:
                 raise Exception("Could not find a submit/generate button.")

        except Exception as e:
            raise Exception(f"Execution failed: {e}")

    def get_all_image_urls(self, driver):
        imgs = driver.find_elements(By.TAG_NAME, "img")
        urls = set()
        for img in imgs:
            try:
                src = img.get_attribute("src")
                if src:
                    urls.add(src)
            except:
                pass
        return urls

    def wait_for_new_image(self, driver, initial_images, timeout, selector=""):
        start_time = time.time()
        while time.time() - start_time < timeout:
            if selector:
                try:
                    el = driver.find_element(By.CSS_SELECTOR, selector)
                    if el.is_displayed():
                        src = el.get_attribute("src")
                        if src and (src not in initial_images or len(initial_images) == 0):
                            return src
                except:
                    pass
            else:
                current_images = self.get_all_image_urls(driver)
                new_images = current_images - initial_images
                
                if new_images:
                    print(f"Found new images: {new_images}")
                    for src in new_images:
                        try:
                            # Verify image size to avoid icons
                            # We can't easily check size by URL without downloading headers,
                            # so we find the element again.
                            # Just grabbing the first new one is usually fine for these tools.
                            return src
                        except:
                            continue
                            
            time.sleep(1.0)
        return None

    def load_image_from_url(self, url, driver=None):
        # Handle data: URLs
        if url.startswith("data:image"):
            import base64
            header, encoded = url.split(";", 1)
            data = encoded.split(",", 1)[1]
            img_bytes = base64.b64decode(data)
            img = Image.open(BytesIO(img_bytes))
        else:
            # Handle http/https with cookies from selenium
            session = requests.Session()
            if driver:
                try:
                    selenium_cookies = driver.get_cookies()
                    for cookie in selenium_cookies:
                        session.cookies.set(cookie['name'], cookie['value'])
                except:
                    pass # Ignore if cookie retrieval fails
            
            # Mimic browser UA
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            response = session.get(url, headers=headers)
            
            if response.status_code != 200:
                raise Exception(f"Failed to download image from {url}, status: {response.status_code}")

            img = Image.open(BytesIO(response.content))

        # Convert to ComfyUI format (Tensor [1, H, W, 3])
        img = img.convert("RGB")
        img = np.array(img).astype(np.float32) / 255.0
        img = torch.from_numpy(img)[None,]
        return img

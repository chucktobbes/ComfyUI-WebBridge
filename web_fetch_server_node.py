import threading
import time
import json
import base64
import socket
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
import torch
import numpy as np
from PIL import Image

# Global state to share between Node and Server Thread
SERVER_STATE = {
    "job": None,          # Current job: {"id": "...", "prompt": "...", "selectors": {...}}
    "result": None,       # Result data: PIL Image or None
    "status": "idle",     # idle, waiting_for_browser, processsing, complete
    "last_error": None,
    "event": threading.Event() # Event to wake up the node
}

PORT = 9955

class RequestHandler(BaseHTTPRequestHandler):
    def _set_headers(self, code=200, content_type='application/json'):
        self.send_response(code)
        self.send_header('Content-type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*') # Allow any browser
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers()

    def do_GET(self):
        if self.path == '/job':
            self._set_headers()
            response = {"job": SERVER_STATE["job"]}
            self.wfile.write(json.dumps(response).encode('utf-8'))
        elif self.path == '/status':
             self._set_headers()
             self.wfile.write(json.dumps({"status": SERVER_STATE["status"]}).encode('utf-8'))
        else:
            self._set_headers(404)

    def do_POST(self):
        if self.path == '/result':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                print(f"[WebBridge] Receiving POST /result. Size: {content_length} bytes")
                
                if content_length == 0:
                     raise Exception("Empty request body")

                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))
                
                if "error" in data:
                     print(f"[WebBridge] Client reported error: {data['error']}")
                     SERVER_STATE["last_error"] = data["error"]
                     SERVER_STATE["result"] = None
                elif "image" in data:
                    b64_str = data["image"]
                    print(f"[WebBridge] Received image data. Length: {len(b64_str)}")
                    
                    if "," in b64_str:
                        header, encoded = b64_str.split(",", 1)
                        print(f"[WebBridge] Image header: {header}")
                    else:
                        encoded = b64_str
                        print(f"[WebBridge] No header found in base64 string.")

                    img_data = base64.b64decode(encoded)
                    img = Image.open(BytesIO(img_data))
                    
                    # Force verify image
                    img.verify() 
                    img = Image.open(BytesIO(img_data)) # Re-open after verify
                    
                    SERVER_STATE["result"] = img
                    print("[WebBridge] Image decoded successfully.")
                
                SERVER_STATE["event"].set()
                self._set_headers()
                self.wfile.write(json.dumps({"status": "received"}).encode('utf-8'))
                
            except Exception as e:
                print(f"[WebBridge] Error processing POST: {e}")
                SERVER_STATE["last_error"] = str(e)
                # Still set event to wake up node and show error
                SERVER_STATE["event"].set() 
                
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self._set_headers(404)

    def log_message(self, format, *args):
        return # Silence server logs

def start_server():
    try:
        server = HTTPServer(('0.0.0.0', PORT), RequestHandler)
        print(f"WebFetch Server started on port {PORT}")
        server.serve_forever()
    except Exception as e:
        print(f"Failed to start server (might be already running): {e}")

# Start server in background thread on module import
server_thread = threading.Thread(target=start_server, daemon=True)
server_thread.start()


class WebFetchServerNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "dynamicPrompts": False}),
            },
            "optional": {
                "timeout": ("INT", {"default": 60, "min": 5, "max": 600}),
                "selector_override_json": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "process"
    CATEGORY = "WebFetch"

    def process(self, prompt, timeout=60, selector_override_json="{}"):
        # 1. Reset State
        SERVER_STATE["event"].clear()
        SERVER_STATE["result"] = None
        SERVER_STATE["last_error"] = None
        
        # 2. Post Job
        try:
             selectors = json.loads(selector_override_json)
        except:
             selectors = {}
             
        SERVER_STATE["job"] = {
            "id": str(time.time()),
            "prompt": prompt,
            "timeout": timeout,
            "selectors": selectors
        }
        SERVER_STATE["status"] = "waiting_for_browser"
        
        print(f"Job posted. Waiting for browser to fetch from http://localhost:{PORT}...")
        
        # 3. Wait
        start_time = time.time()
        while time.time() - start_time < timeout:
            if SERVER_STATE["event"].is_set():
                break
            time.sleep(0.5)
            
        # 4. Process Result
        SERVER_STATE["job"] = None # Clear job
        SERVER_STATE["status"] = "idle"
        
        if SERVER_STATE["last_error"]:
             raise Exception(f"Browser reported error: {SERVER_STATE['last_error']}")
             
        if SERVER_STATE["result"] is None:
            raise Exception("Timeout: Browser did not send a result in time. Make sure the Userscript is running.")
            
        # Convert PIL to Tensor
        img = SERVER_STATE["result"].convert("RGB")
        img = np.array(img).astype(np.float32) / 255.0
        img = torch.from_numpy(img)[None,]
        
        return (img,)

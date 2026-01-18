from .web_fetch_node import WebFetchNode
from .web_fetch_server_node import WebFetchServerNode

NODE_CLASS_MAPPINGS = {
    "WebFetchNode": WebFetchNode,
    "WebFetchServerNode": WebFetchServerNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WebFetchNode": "Web Fetch (Selenium)",
    "WebFetchServerNode": "Web Fetch (Userscript / Bridge)"
}


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

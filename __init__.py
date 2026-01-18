from .web_fetch_server_node import WebFetchServerNode

NODE_CLASS_MAPPINGS = {
    "WebFetchServerNode": WebFetchServerNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WebFetchServerNode": "Web Bridge (Tampermonkey)"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

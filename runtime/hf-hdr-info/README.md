---
license: openrail++
library_name: diffusers
base_model: Lightricks/LTX-Video
tags:
  - lora
  - text-to-video
  - ltx
  - ltx-video
  - ltxv-2.3
pipeline_tag: text-to-video
---

# LTX2.3_IC_HDR_LORA

![preview](./preview.jpg)

**Base model**: LTXV 2.3
**Trained words**: 

## 🧠 Usage (Python)

🔑 **Get your MUAPI key** from [muapi.ai/access-keys](https://muapi.ai/access-keys)

```python
import requests, os
url = "https://api.muapi.ai/api/v1/ltx_lora_video"
headers = {"Content-Type": "application/json", "x-api-key": os.getenv("MUAPIAPP_API_KEY")}
payload = {
    "prompt": "masterpiece, best quality",
    "lora_model": "ltx2.3_ic_hdr_lora",
    "lora_strength": 1.0,
    "width": 768,
    "height": 512,
    "num_frames": 97
}
print(requests.post(url, headers=headers, json=payload).json())
```

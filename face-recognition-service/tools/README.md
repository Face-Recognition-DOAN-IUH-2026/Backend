# Dev Tools

Local development scripts. Excluded from Docker builds via `.dockerignore`.

## camera-latency.py

Camera pipeline latency benchmark for face-recognition-service.

```bash
python tools/camera-latency.py --base-url http://localhost:8080 --iterations 10
python tools/camera-latency.py --base-url http://localhost:8080 --image face.jpg
```

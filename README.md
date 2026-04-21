# 🚁 Smart Drone Traffic Analyzer ([ANTS] PoC)

This repository contains a full-stack proof-of-concept application for autonomous drone video traffic analysis. The solution ingests aerial footage, precisely tracks individual vehicles across frames without double-counting, and exports summarized analytics.

It adopts a **Full-Stack Web Architecture** bridging Python's machine learning capabilities with Next.js's state-of-the-art UI responsiveness, completely bypassing naive UI wrappers like Streamlit/Gradio as mandated.

---

## 🛠 Step-by-Step Local Setup

Ensure you have **Python 3.9+** and **Node.js 18+** installed on your system.
*(Note: NEVER commit the `venv` or `node_modules` folders to the GitHub repository. A `.gitignore` is provided to safeguard this.)*

### 1. Initialize the Backend (Python / FastAPI)
The Backend hosts our intensive Computer Vision pipeline.
1. Open a terminal and navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Virtual Environment (Mandatory to isolate dependencies!):
   ```bash
   python -m venv venv
   # Windows:
   .\venv\Scripts\activate
   # Mac/Linux:
   source venv/bin/activate
   ```
3. Install the Core Requirements (FastAPI, Ultralytics, OpenCV, Pandas):
   ```bash
   pip install -r requirements.txt
   ```
4. Start the `uvicorn` development server:
   ```bash
   uvicorn main:app --reload
   # It mounts gracefully on http://localhost:8000
   ```

### 2. Initialize the Frontend (React / Next.js)
1. Open a *new* terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install the javascript dependencies:
   ```bash
   npm install
   ```
3. Boot the Next.js development server:
   ```bash
   npm run dev
   # Access the interactive dashboard at http://localhost:3000
   ```

---

## 🏗 Breakdown of Architecture

### Decoupled Ecosystem
To ensure the UI remains highly responsive during the extremely CPU-heavy processing of video feeds, the architecture is deliberately decoupled:
- **Frontend** built in React (Next.js) heavily utilizing purely native vanilla CSS (`globals.css`) for a premium styling aesthetic.
- **Backend** built with `FastAPI` natively designed to execute asynchronous endpoints perfectly. 

### Concurrency Management 
FastAPI's asynchronous event loop naturally handles IO-bound concurrency, allowing our server to host massive video processing tasks.
- **Upload Flow**: Frontend performs a standard REST `POST /upload`. The video chunk is securely streamed and saved to local disk.
- **Preview Flow**: Frontend performs a standard REST `GET /frame/{filename}`. OpenCV grabs exactly the 0th frame so the user can interactively calibrate the math configuration in real time against the actual video perspective.
- **Processing Flow (WebSocket)**: When counting begins, Next.js opens a continuous duplex `WebSocket` channel (`ws://`) pointing to the active FastAPI endpoint. The backend initializes `YOLOv8` within a generator. To keep the Python Event-Loop unbroken and avoid freezing logic threads, the generator routinely captures micro-pauses via `await asyncio.wait_for(..., timeout=0.005)`. This enables it to securely flush compressed video frames + live vehicle counts over the socket iteratively while simultaneously checking for cancellation network events.

---

## 🧭 Tracking Methodology & Edge Cases

### Computer Vision Engine
- **Detection**: Powered by the highly reliable `YOLOv8n` via the `ultralytics` package. Pre-filtered directly to analyze matrices representing key traffic parameters (car, truck, bus, motorcycle).
- **Tracking Algorithm**: We implemented **ByteTrack**. In drone footage, vehicles reliably pass under trees, power lines, or traffic bridges. ByteTrack utilizes low-confidence bounding-box correlation algorithms to flawlessly maintain trajectory histories across partial-occlusions. 

### The Double-Counting Solution (2D CCW Logic)
A major bottleneck of standard tracking pipelines is counting vehicles *multiple times* due to stuttering frames or reversing. To prevent this entirely:
1. We introduced a **Geometric 2D Vector Intersection Algorithm**. 
2. Users assign a logical counting line (Angle and Placement) dynamically over the 0th frame via the UI Dashboard setup interface.
3. Over in Python, evaluating vehicles actively maintains their `(X, Y)` centroid history.
4. Leveraging the `Counter-Clockwise (CCW)` intersection mathematical test, the script continuously evaluates whether the vector drawn from `Centroid_{t-1}` to `Centroid_{t}` perfectly crosses the dynamic Tracking Line coordinates.
5. If it mathematically breaches the line, the internal unique vehicle ID is hashed to a Python memory `Set()`. A `Set` guarantees mathematically that even if a car brakes repeatedly against the vector or moves backward, it can physically never be stored (and therefore counted) twice.

---

## 🧠 Engineering Assumptions

- **Variable Camera Angles**: We made the key assumption that the drone's position is rarely flawlessly parallel to the asphalt road. For static city cameras, a primitive integer `y > fixedValue` comparison suffices. In drones, the camera pitch/yaw forces roads to tilt. Thus, our solution mandates providing the user with **Tilt Angle & Position Geometry Configuration**. Without this assumption, drone footage algorithms routinely fail.
- **WebSocket Network Saturation**: Serving purely uncompressed 1080p frames rapidly over a dual-Websocket continuously will ultimately throttle internal RAM caches or stall most basic browsers. We assumed efficiency deeply outweighs aesthetic resolution. Therefore, during the generation, we force `cv2` to compress frames significantly and resize scaling to 800px max. This keeps the network JSON byte string exceedingly lightweight and secures the stability of the browser process during intense video analysis.
- **Reporting**: The processed payload is stored in a `pandas` DataFrame inside rapid memory (`reports_db`) temporarily until queried by the download endpoint. For a full production architecture, this would eventually export properly into persistent remote Postgres databases.

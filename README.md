# 🚁 Smart Drone Traffic Analyzer ([ANTS] PoC)

This repository contains a full-stack proof-of-concept application for autonomous drone video traffic analysis. The solution ingests aerial footage, precisely tracks individual vehicles across frames without double-counting, and exports summarized analytics.

It adopts a **Full-Stack Web Architecture** bridging Python's machine learning capabilities with Next.js's UI responsiveness, completely bypassing naive UI wrappers like Streamlit/Gradio as mandated.

---

## 🛠 Step-by-Step Local Setup

Ensure you have **Python 3.9+** and **Node.js 18+** installed on your system.

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
- **Frontend** built in React (Next.js) heavily utilizing purely native vanilla CSS (globals.css) for a premium styling aesthetic.
- **Backend** built with FastAPI natively designed to execute asynchronous endpoints perfectly. 

### Concurrency Management & Threading
FastAPI's asynchronous event loop naturally handles IO-bound concurrency, allowing our server to host massive video processing tasks without blocking the network threads.
- **Upload Flow**: Frontend performs a standard REST POST /upload. The video chunk is securely streamed and saved to local disk.
- **Preview Flow (Expert Mode)**: Frontend performs a standard REST GET /frame/{filename}. OpenCV grabs exactly the 0th frame. Instead of generic sliders, the user is presented with a full HTML5/SVG interactive canvas. The user can drag and drop multiple custom intersection logic gates ("Multi-Gate") perfectly over the video bounds utilizing pure frontend state mapping.
- **Processing Flow (WebSocket)**: When counting begins, Next.js opens a continuous duplex WebSocket channel (ws://) pointing to the active FastAPI endpoint, handing over the user-drawn Vector Array payload via JSON. The backend initializes YOLOv8 within a generator. To keep the Python Event-Loop unbroken and avoid freezing logic threads, the generator routinely captures micro-pauses via await asyncio.wait_for(..., timeout=0.005). This yields priority back to the Async controller, enabling it to securely flush compressed video frames + live multi-lane vehicle counts over the socket iteratively while simultaneously checking for early-cancellation network events.

---

## 🧭 Tracking Methodology & Edge Cases

### Computer Vision Engine
- **Detection**: Powered by the highly reliable YOLOv8n via the ultralytics package. Pre-filtered directly to analyze matrices representing specific traffic parameters (car, truck, bus, motorcycle).
- **Tracking Algorithm**: I utilized ByteTrack. In drone footage, vehicles reliably pass under trees, power lines, or traffic bridges. ByteTrack utilizes low-confidence bounding-box spatial correlation algorithms to flawlessly maintain trajectory histories across heavy partial-occlusions compared to older BoT-SORT models.

### The Double-Counting Solution (2D CCW Array Logic)
A major bottleneck of standard tracking pipelines is counting vehicles *multiple times* due to stuttering frames or reversing. To prevent this entirely:
1. I engineered a **Geometric 2D Vector Intersection Algorithm**. 
2. Over in Python, evaluating vehicles actively maintains their (X, Y) pixel centroid history frame by frame.
3. Leveraging the Counter-Clockwise (CCW) intersection mathematical test, the script continuously evaluates whether the internal displacement vector drawn from Centroid_{t-1} to Centroid_{t} perfectly intersects *any* of the user-drawn bounds in the array.
4. If it mathematically breaches a user's defined line segment, the internal unique vehicle ID is exclusively hashed to a Python memory Set() tied directly to that line. A Set structure guarantees mathematically that even if a car brakes repeatedly against the vector or moves backward across the line, it can physically never be hashed (and therefore counted) twice.

---

## 🧠 Engineering Assumptions

- **Variable Camera Angles (Multi-Gate Imperative)**: I made the crucial assumption that the drone's position is rarely flawlessly parallel to the asphalt road. For static city cameras, a primitive mathematical integer y > fixedValue comparison suffices. In drones, the variable camera pitch and yaw heavily forces roads to tilt/warp diagonally. Thus, my solution mandates utilizing the interactive **SVG Multi-Gate Configuration Module**. By drawing logic lines natively over the exact frame, algorithms perfectly adapt to drone angles.
- **WebSocket Network Saturation**: Serving purely uncompressed 1080p frames rapidly over a dual-Websocket continuously will ultimately throttle internal RAM caches or stall most basic browsers. I assumed analytical efficiency deeply outweighs pure visual aesthetic resolution playback during processing. Therefore, during generation, I force cv2 to compress frames aggressively and resize the UI stream scaling. This keeps the network JSON byte string exceedingly lightweight and secures the stability of the browser process during intense video analysis.
- **Reporting Tally**: Given it now supports Multiple-Lines, I assumed that users require per-lane logic segregation. The processed payload is explicitly broken out (e.g., Line 1 count, Line 2 count) both in the Next.js visual dashboard and inside the temporary pandas DataFrame memory (reports_db) until physically exported to CSV by the user.

---

## 🎥 Video Guide(Demo)

Watch the demonstration of the system in action below.

<video src="./Guide_or_Demo.mp4" controls="controls" width="100%" style="max-width: 100%;">
  Your browser does not support the video tag.
</video>

*(If the video does not play above, click [here](./Guide_or_Demo.mp4) to open it directly.)*

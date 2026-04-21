import os
import base64
import json
import asyncio
import cv2
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from cv_pipeline import DroneTrafficAnalyzer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# In-memory store for reports DataFrame (POC only)
reports_db = {}

@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    if not file.filename.endswith('.mp4'):
        return {"error": "Only .mp4 files are supported"}
        
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
        
    return {"filename": file.filename, "message": "Upload successful"}

@app.get("/frame/{filename}")
async def get_first_frame(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        return {"error": "File not found"}
        
    cap = cv2.VideoCapture(file_path)
    success, frame = cap.read()
    cap.release()
    
    if not success:
        return {"error": "Could not read video"}
        
    display_width = 800
    height, width = frame.shape[:2]
    if width > display_width:
        scale = display_width / width
        frame = cv2.resize(frame, (display_width, int(height * scale)))
        
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    frame_b64 = base64.b64encode(buffer).decode('utf-8')
    return {"frame": frame_b64}

@app.websocket("/ws/process/{filename}")
async def process_video_ws(websocket: WebSocket, filename: str, lines: str = "[]"):
    await websocket.accept()
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    if not os.path.exists(file_path):
        await websocket.send_text(json.dumps({"error": "File not found"}))
        await websocket.close()
        return
        
    try:
        parsed_lines = json.loads(lines)
    except Exception:
        parsed_lines = []
        
    analyzer = DroneTrafficAnalyzer(lines=parsed_lines)
    
    try:
        for result in analyzer.process_video(file_path):
            if "error" in result:
                await websocket.send_text(json.dumps({"error": result["error"]}))
                break
                
            frame_b64 = base64.b64encode(result["frame"]).decode('utf-8')
            payload = {
                "frame": frame_b64,
                "count": result["current_count"],
                "progress": result["progress"] * 100,
                "line_counts": result.get("line_counts", {})
            }
            await websocket.send_text(json.dumps(payload))
            
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.005)
                try:
                    data = json.loads(msg)
                    if data.get("action") == "cancel":
                        break
                except json.JSONDecodeError:
                    pass
            except asyncio.TimeoutError:
                pass
            
        # Processing completed
        df = analyzer.get_report_df()
        reports_db[filename] = df
        
        await websocket.send_text(json.dumps({
            "status": "complete",
            "message": "Processing finished",
            "report_url": f"/download/{filename}",
            "final_count": len(analyzer.global_counted_ids),
            "final_line_counts": { lid: len(ids) for lid, ids in analyzer.counted_ids.items() }
        }))
        
    except WebSocketDisconnect:
        print("Client disconnected.")
    except Exception as e:
        print(f"Error: {e}")
        try:
             await websocket.send_text(json.dumps({"error": str(e)}))
        except:
             pass
    finally:
        try:
            await websocket.close()
        except:
            pass

@app.get("/download/{filename}")
async def download_report(filename: str):
    if filename not in reports_db:
        return {"error": "Report not found"}
        
    df = reports_db[filename]
    csv_str = df.to_csv(index=False)
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=report_{filename}.csv"}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

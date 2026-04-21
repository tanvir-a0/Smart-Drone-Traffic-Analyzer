import cv2
import gc
import math
import pandas as pd
from ultralytics import YOLO

class DroneTrafficAnalyzer:
    def __init__(self, model_path="yolov8n.pt", line_position_ratio=0.5, line_angle_degrees=0.0):
        # We will use yolov8n.pt natively downloaded by ultralytics
        self.model = YOLO(model_path)
        self.line_position_ratio = line_position_ratio # 0.5 means middle of frame horizontally
        self.line_angle_degrees = line_angle_degrees
        self.class_names = self.model.names
        # Target classes: car, motorcycle, bus, truck. COCO map: {2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}
        self.target_classes = [2, 3, 5, 7] 
        self.counted_ids = set()
        self.tracking_data = [] # For reporting: list of dicts

    def ccw(self, A, B, C):
        return (C[1]-A[1]) * (B[0]-A[0]) > (B[1]-A[1]) * (C[0]-A[0])

    def intersects(self, A, B, C, D):
        return self.ccw(A,C,D) != self.ccw(B,C,D) and self.ccw(A,B,C) != self.ccw(A,B,D)

    def process_video(self, video_path):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            yield {"error": "Could not open video."}
            return
            
        fps = cap.get(cv2.CAP_PROP_FPS)
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        mid_y = height * self.line_position_ratio
        mid_x = width / 2.0
        theta = math.radians(self.line_angle_degrees)
        dx = math.cos(theta)
        dy = math.sin(theta)
        
        if abs(dx) > 0.0001:
            t_left = -mid_x / dx
            t_right = (width - mid_x) / dx
            pt1 = (0, int(mid_y + t_left * dy))
            pt2 = (width, int(mid_y + t_right * dy))
        else:
            pt1 = (int(mid_x), 0)
            pt2 = (int(mid_x), height)
            
        track_history = {} # id -> list of track centers
        
        # Results iteration
        try:
            results_generator = self.model.track(
                video_path, persist=True, tracker="bytetrack.yaml", classes=self.target_classes, stream=True, verbose=False
            )
            
            frame_idx = 0
            for results in results_generator:
                frame = results.orig_img.copy()
                frame_idx += 1
                timestamp = frame_idx / fps if fps > 0 else 0
                
                # Draw counting line
                cv2.line(frame, pt1, pt2, (0, 0, 255), 2)
                cv2.putText(frame, "Counting Line", (pt1[0] + 10, pt1[1] - 10 if pt1[1] > 20 else pt1[1] + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)

                boxes = results.boxes
                if boxes is not None and boxes.id is not None:
                    track_ids = boxes.id.int().cpu().tolist()
                    clss = boxes.cls.int().cpu().tolist()
                    xyxys = boxes.xyxy.cpu().tolist()
                    
                    for track_id, cls, xyxy in zip(track_ids, clss, xyxys):
                        # compute centroid
                        x1, y1, x2, y2 = xyxy
                        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                        
                        track = track_history.get(track_id, [])
                        track.append((cx, cy))
                        if len(track) > 30: # keep history bounded
                            track.pop(0)
                        track_history[track_id] = track
                        
                        class_name = self.class_names[cls]
                        
                        # check crossing
                        if len(track) >= 2 and track_id not in self.counted_ids:
                            prev_c = track[-2]
                            curr_c = track[-1]
                            if self.intersects(prev_c, curr_c, pt1, pt2):
                                self.counted_ids.add(track_id)
                                # Log data
                                self.tracking_data.append({
                                    "Track ID": track_id,
                                    "Vehicle Type": class_name,
                                    "Frame": frame_idx,
                                    "Timestamp (s)": round(timestamp, 2)
                                })
                                
                        # Draw annotations
                        color = (0, 255, 0) if track_id in self.counted_ids else (255, 0, 0)
                        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
                        label = f"{class_name} #{track_id}"
                        cv2.putText(frame, label, (int(x1), int(y1) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
                # We yield frames every N frames or resize it heavily to avoid websocket congestion
                # Resize the frame to max width 800 for faster transmission
                display_width = 800
                if width > display_width:
                    scale = display_width / width
                    frame = cv2.resize(frame, (display_width, int(height * scale)))
                
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
                frame_bytes = buffer.tobytes()
                
                yield {
                    "frame": frame_bytes,
                    "current_count": len(self.counted_ids),
                    "progress": frame_idx / total_frames if total_frames > 0 else 0,
                    "total_frames": total_frames,
                    "frame_idx": frame_idx
                }
                
                # Manual garbage collection to prevent memory leak
                if frame_idx % 100 == 0:
                    gc.collect()
                    
        except Exception as e:
            yield {"error": str(e)}
        finally:
            cap.release()
        
    def get_report_df(self):
        return pd.DataFrame(self.tracking_data)

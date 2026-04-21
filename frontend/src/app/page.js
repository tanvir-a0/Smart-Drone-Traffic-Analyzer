"use client";

import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, processing, complete, error
  const [progress, setProgress] = useState(0);
  const [currentCount, setCurrentCount] = useState(0);
  const [frameSrc, setFrameSrc] = useState(null);
  const [reportUrl, setReportUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lineCounts, setLineCounts] = useState({});
  const [lines, setLines] = useState([{ id: "Line 1", x1: 20, y1: 50, x2: 80, y2: 50 }]);
  const [draggingPoint, setDraggingPoint] = useState(null);
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [previewFrame, setPreviewFrame] = useState(null);
  const fileInputRef = useRef(null);
  const wsRef = useRef(null);

  const handlePointerDown = (index, pointType) => (e) => {
    e.target.setPointerCapture(e.pointerId);
    setDraggingPoint({ index, pointType });
  };

  const handlePointerMove = (e) => {
    if (!draggingPoint) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - rect.left) / rect.width * 100, 0), 100);
    const y = Math.min(Math.max((e.clientY - rect.top) / rect.height * 100, 0), 100);
    
    setLines(prev => {
        const newLines = [...prev];
        const l = { ...newLines[draggingPoint.index] };
        if (draggingPoint.pointType === 'p1') { l.x1 = x; l.y1 = y; }
        else { l.x2 = x; l.y2 = y; }
        newLines[draggingPoint.index] = l;
        return newLines;
    });
  };

  const handlePointerUp = (e) => {
    if (draggingPoint) setDraggingPoint(null);
  };

  const addLine = () => {
    setLines([...lines, { id: `Line ${lines.length + 1}`, x1: 20, y1: 60, x2: 80, y2: 60 }]);
  };

  const removeLine = (index) => {
    if (lines.length > 1) {
        setLines(lines.filter((_, i) => i !== index));
    } else {
        setErrorMessage("At least one tracking line is required.");
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const handleFileSelection = (selectedFile) => {
    if (!selectedFile.name.endsWith('.mp4')) {
      setStatus('error');
      setErrorMessage("Please upload an .mp4 video file.");
      return;
    }
    setFile(selectedFile);
    setStatus('idle');
    setErrorMessage("");
  };

  const startUpload = async () => {
    if (!file) return;
    setStatus('uploading');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const host = window.location.hostname;
      const response = await fetch(`http://${host}:8000/upload`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      if (data.error) {
        setStatus('error');
        setErrorMessage(data.error);
        return;
      }
      
      setUploadedFilename(data.filename);
      fetchPreviewFrame(data.filename, host);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message);
    }
  };

  const fetchPreviewFrame = async (filename, host) => {
    try {
      const response = await fetch(`http://${host}:8000/frame/${encodeURIComponent(filename)}`);
      const data = await response.json();
      if (data.error) {
        setStatus('error');
        setErrorMessage(data.error);
        return;
      }
      setPreviewFrame(`data:image/jpeg;base64,${data.frame}`);
      setStatus('configuring');
    } catch (err) {
      setStatus('error');
      setErrorMessage("Failed to fetch video preview frame.");
    }
  };

  const startProcessing = (filename) => {
    setStatus('processing');
    setProgress(0);
    setCurrentCount(0);
    setLineCounts({});
    setFrameSrc(null);
    const host = window.location.hostname;
    const encodedLines = encodeURIComponent(JSON.stringify(lines));
    const ws = new WebSocket(`ws://${host}:8000/ws/process/${encodeURIComponent(filename)}?lines=${encodedLines}`);
    wsRef.current = ws;
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        setStatus('error');
        setErrorMessage(data.error);
        ws.close();
        return;
      }
      
      if (data.status === 'complete') {
        setStatus('complete');
        setReportUrl(`http://${host}:8000${data.report_url}`);
        if (data.final_count !== undefined) setCurrentCount(data.final_count);
        if (data.final_line_counts !== undefined) setLineCounts(data.final_line_counts);
        ws.close();
        return;
      }
      
      if (data.frame) {
        setFrameSrc(`data:image/jpeg;base64,${data.frame}`);
      }
      if (data.count !== undefined) setCurrentCount(data.count);
      if (data.progress !== undefined) setProgress(data.progress);
      if (data.line_counts !== undefined) setLineCounts(data.line_counts);
    };
    
    ws.onerror = (error) => {
      setStatus('error');
      setErrorMessage('WebSocket connection failed.');
    };
  };

  return (
    <main className="container">
      <div className="header">
        <h1 className="title">Smart Drone Traffic Analyzer</h1>
        <p className="subtitle">Upload drone footage to automatically count and track unique vehicles.</p>
      </div>

      <div className="glass-panel">
        {status === 'idle' || status === 'error' ? (
          <>
            <div 
              className="upload-zone"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="video/mp4" 
                className="file-input" 
              />
              <div className="upload-icon">📹</div>
              <h3>{file ? file.name : "Drag & Drop or Click to Upload .mp4"}</h3>
              <p style={{ marginTop: "10px", color: "var(--text-secondary)" }}>
                {file ? "Ready to process" : "Max size limited by your machine's memory"}
              </p>
            </div>
            
            {status === 'error' && (
              <p style={{ color: '#ef4444', textAlign: 'center', marginTop: '1rem' }}>{errorMessage}</p>
            )}
            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <button 
                className="btn" 
                onClick={startUpload} 
                disabled={!file || status === 'uploading'}
              >
                {status === 'uploading' ? 'Extracting Preview...' : 'Next: Configure Tracking'}
              </button>
            </div>
          </>
        ) : status === 'configuring' ? (
          <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
             <h3 style={{ marginBottom: "0.5rem", color: "var(--text-primary)", textAlign: "center" }}>Configure Tracking Geometry</h3>
             <p style={{ marginBottom: "2rem", color: "var(--text-secondary)", textAlign: "center" }}>Align the red line exactly where you want vehicles to be counted.</p>
             
             <div 
                className="video-container" 
                style={{ marginBottom: "2rem", position: 'relative', touchAction: 'none' }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
             >
                <img src={previewFrame} alt="Frame 0" className="video-stream" draggable={false} style={{ userSelect: 'none' }} />
                <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 10 }}>
                  {lines.map((l, i) => (
                      <g key={i}>
                         <line x1={`${l.x1}%`} y1={`${l.y1}%`} x2={`${l.x2}%`} y2={`${l.y2}%`} strokeWidth="4" stroke="#ef4444" />
                         <circle cx={`${l.x1}%`} cy={`${l.y1}%`} r="12" fill="white" stroke="#ef4444" strokeWidth="4" style={{ cursor: 'grab' }} onPointerDown={handlePointerDown(i, 'p1')} />
                         <circle cx={`${l.x2}%`} cy={`${l.y2}%`} r="12" fill="white" stroke="#ef4444" strokeWidth="4" style={{ cursor: 'grab' }} onPointerDown={handlePointerDown(i, 'p2')} />
                         <text x={`${(l.x1+l.x2)/2}%`} y={`${(l.y1+l.y2)/2 - 3}%`} fill="#ef4444" fontSize="18" fontWeight="bold" textAnchor="middle" pointerEvents="none">{l.id}</text>
                      </g>
                  ))}
                </svg>
             </div>

             <div style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                   <h4 style={{ color: 'var(--text-primary)', margin: 0 }}>Active Tracking Gates</h4>
                   <button onClick={addLine} className="btn" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', background: 'var(--accent)' }}>+ Add Grid Line</button>
                </div>
                
                {lines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '0.5rem' }}>
                       <span style={{ fontWeight: 'bold' }}>{l.id}</span>
                       <button onClick={() => removeLine(i)} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '0.2rem 0.5rem', cursor: 'pointer' }}>Delete</button>
                    </div>
                ))}
             </div>

            <div style={{ textAlign: 'center', marginTop: '2rem' }}>
              <button 
                className="btn" 
                onClick={() => startProcessing(uploadedFilename)}
              >
                Confirm Geometry & Start Analysis
              </button>
            </div>
          </div>
        ) : (
          <div className="dashboard">
            <div className="main-panel">
              <div className="video-container">
                {frameSrc ? (
                  <img src={frameSrc} className="video-stream" alt="Video stream" />
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div className="loader" style={{ marginBottom: "1rem" }}></div>
                    <p>Initializing Computer Vision Pipeline...</p>
                  </div>
                )}
              </div>
              
              <div style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>{status === 'complete' ? 'Processing Complete' : 'Processing Video...'}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            </div>
            
            <div className="side-panel">
              <div className="stats-card">
                <div className="stat-label">Total Unique Vehicles</div>
                <div className="stat-value">{currentCount}</div>
                <div className="stat-label" style={{ fontSize: "0.75rem", marginTop: "-5px" }}>Across all boundaries</div>
              </div>

              {Object.keys(lineCounts).length > 0 && (
                 <div className="stats-card" style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.2)' }}>
                    <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Per-Line Breakdown</h4>
                    {Object.entries(lineCounts).map(([lid, count]) => (
                        <div key={lid} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                            <span style={{ fontSize: '0.9rem' }}>{lid}</span>
                            <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{count}</span>
                        </div>
                    ))}
                 </div>
              )}
              
              {status === 'processing' && (
                <div style={{ textAlign: "center", marginTop: "2rem", color: "var(--text-secondary)" }}>
                  <div className="loader" style={{ marginBottom: "1rem", borderColor: "rgba(255,255,255,0.1)", borderTopColor: "var(--accent)", width: 30, height: 30 }}></div>
                  <p>YOLOv8 + ByteTrack Engine Running</p>
                  
                  <button 
                    className="btn" 
                    style={{ marginTop: '1.5rem', background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", border: "1px solid #ef4444", width: "100%" }}
                    onClick={() => {
                       if (wsRef.current) {
                           wsRef.current.send(JSON.stringify({ action: "cancel" }));
                       }
                    }}
                  >
                    ✖ Cancel Early & Export
                  </button>
                </div>
              )}
              
              {status === 'complete' && reportUrl && (
                <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                  <h3 style={{ marginBottom: "1rem", color: "var(--success)" }}>Ready for Export</h3>
                  <a href={reportUrl} download className="btn" style={{ background: "var(--success)", display: "flex", width: "100%" }}>
                    Download CSV Report ⬇️
                  </a>
                  
                  <button 
                    className="btn" 
                    style={{ marginTop: '1rem', background: "var(--panel-border)", width: "100%" }}
                    onClick={() => { setFile(null); setStatus('idle'); }}
                  >
                    Analyze Another Video
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

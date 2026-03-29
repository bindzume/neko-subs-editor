import React, { useState, useRef, useEffect } from 'react';
import JASSUB from 'jassub';
// Tell Vite to compile the worker into browser-safe code and give us the URL


export default function TestApp() {
  const [videoUrl, setVideoUrl] = useState(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const jassubRef = useRef(null);

  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoUrl(URL.createObjectURL(file));
    }
  };

  useEffect(() => {
    if (!videoUrl || !videoRef.current || !containerRef.current) return;

    const initJassub = () => {
      // 1. Destroy old instance if it exists
      if (jassubRef.current) {
        jassubRef.current.destroy();
        jassubRef.current = null;
      }

      // 2. Remove any old canvas to prevent OffscreenCanvas crash
      const oldCanvas = containerRef.current.querySelector('canvas');
      if (oldCanvas) oldCanvas.remove();

      // 3. Manually create a fresh canvas and inject it
      const canvas = document.createElement('canvas');
      
      // Bulletproof inline styles to stack it over the video
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      canvas.style.objectFit = 'contain';
      canvas.style.zIndex = '9999';
      canvas.style.border = '4px solid red'; // PROOF THE CANVAS EXISTS
      canvas.style.backgroundColor = 'rgba(0, 0, 255, 0.2)'; // Faint blue tint
      
      containerRef.current.appendChild(canvas);

      // 4. Hardcoded indestructible ASS text (0 to 60 minutes)
      const testAss = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,150,&H000000FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,5,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,1:00:00.00,Default,,0,0,0,,GIANT RED TEST TEXT`;

      // 5. Fire up JASSUB
      // 5. Fire up JASSUB with DEBUGGING ON
      // --- DIAGNOSTIC TRIPWIRE ---
      console.log("Testing raw worker execution...");
      const testWorker = new Worker('/jassub/jassub-worker.js');
      testWorker.onerror = (err) => console.error("🚨 FATAL WORKER CRASH:", err.message, err);
      // ---------------------------
      try {
        console.log("Attempting to initialize JASSUB...");
        
        jassubRef.current = new JASSUB({
          video: videoRef.current,
          canvas: canvas,
          subContent: testAss,
          debug: true // <-- THIS IS NEW: Forces JASSUB to log everything
        });

        // Listen for internal JASSUB events
        jassubRef.current.onReady = () => console.log("🟢 JASSUB Engine Ready and Loaded!");
        jassubRef.current.onError = (err) => console.error("🔴 JASSUB Internal Error:", err);

        // Force a tiny frame update to trigger the renderer
        setTimeout(() => {
          if (videoRef.current && videoRef.current.paused) {
            videoRef.current.currentTime = 0.001;
          }
        }, 500);

      } catch (err) {
        console.error("JASSUB Try/Catch failed:", err);
      }
    };

    // Wait for the video to load its metadata before attaching JASSUB
    const videoEl = videoRef.current;
    videoEl.addEventListener('loadedmetadata', initJassub);

    return () => {
      videoEl.removeEventListener('loadedmetadata', initJassub);
      if (jassubRef.current) jassubRef.current.destroy();
    };
  }, [videoUrl]);

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', background: '#111', minHeight: '100vh', color: 'white' }}>
      <h1>JASSUB Minimal Sanity Check</h1>
      <input type="file" accept="video/*" onChange={handleVideoUpload} style={{ display: 'block', margin: '20px 0' }} />
      
      {videoUrl && (
        <div 
          ref={containerRef} 
          style={{ 
            position: 'relative', 
            width: '800px', 
            maxWidth: '100%', 
            aspectRatio: '16/9', 
            backgroundColor: 'black',
            border: '2px solid #333'
          }}
        >
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: '100%', 
              objectFit: 'contain' 
            }}
          />
        </div>
      )}
    </div>
  );
}
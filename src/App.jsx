import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Download, 
  FileText, 
  Video, 
  Clock, 
  ChevronLeft, 
  ChevronRight,
  FastForward,
  Rewind,
  Play,
  Pause,
  Save
} from 'lucide-react';

// --- Helper Functions ---

const timeToSeconds = (timeStr) => {
  if (!timeStr) return 0;
  try {
    const normalizedStr = timeStr.replace('.', ',');
    const [time, ms] = normalizedStr.split(',');
    if (!time || !ms) return null;
    const [h, m, s] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m) || isNaN(s) || isNaN(ms)) return null;
    return h * 3600 + m * 60 + s + (Number(ms) / 1000);
  } catch (e) {
    return null;
  }
};

const secondsToTime = (seconds) => {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

const parseSRT = (srtText) => {
  // Normalize line endings and split by double blank lines
  const blocks = srtText.trim().replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const parsed = [];

  blocks.forEach((block) => {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const id = lines[0].trim();
      const timeLine = lines[1];
      const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
      
      if (timeMatch) {
        const startStr = timeMatch[1];
        const endStr = timeMatch[2];
        const text = lines.slice(2).join('\n');
        
        parsed.push({
          id,
          start: timeToSeconds(startStr) || 0,
          end: timeToSeconds(endStr) || 0,
          text,
          startStr,
          endStr
        });
      }
    }
  });
  return parsed;
};

const stringifySRT = (subtitles) => {
  return subtitles.map((sub, index) => {
    const startStr = secondsToTime(sub.start);
    const endStr = secondsToTime(sub.end);
    return `${index + 1}\n${startStr} --> ${endStr}\n${sub.text}`;
  }).join('\n\n') + '\n';
};

// --- Main Component ---

export default function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [srtFile, setSrtFile] = useState(null);
  const [subtitles, setSubtitles] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [globalShiftMs, setGlobalShiftMs] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  
  const videoRef = useRef(null);
  const subtitleListRef = useRef(null);
  const fileInputVideo = useRef(null);
  const fileInputSrt = useRef(null);

  // --- Autosave Effects ---
  // Load from localStorage on mount
  useEffect(() => {
    const savedData = localStorage.getItem('subsync_pro_autosave');
    if (savedData) {
      try {
        const { subs, fileName } = JSON.parse(savedData);
        if (subs && subs.length > 0) {
          setSubtitles(subs);
          if (fileName) {
            setSrtFile({ name: fileName }); // Mock file object just to preserve the export name
          }
        }
      } catch (e) {
        console.error("Failed to load autosave", e);
      }
    }
  }, []);

  // Save to localStorage when subtitles change
  useEffect(() => {
    if (subtitles.length > 0) {
      const dataToSave = {
        subs: subtitles,
        fileName: srtFile ? srtFile.name : 'synced_subtitles.srt'
      };
      localStorage.setItem('subsync_pro_autosave', JSON.stringify(dataToSave));
      setSaveStatus('Autosaved just now');
      const timer = setTimeout(() => setSaveStatus(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [subtitles, srtFile]);

  // --- Smooth Video Time Tracking ---
  useEffect(() => {
    // The default onTimeUpdate event only fires ~4 times a second. 
    // This high-frequency interval updates the time smoothly 25 times a second for precise millisecond display.
    const intervalId = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setCurrentTime(videoRef.current.currentTime);
      }
    }, 40); 
    
    return () => clearInterval(intervalId);
  }, []);

  // File Processors
  const processVideoFile = (file) => {
    if (file) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
    }
  };

  const processSrtFile = (file) => {
    if (file) {
      setSrtFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        const parsedSubs = parseSRT(event.target.result);
        setSubtitles(parsedSubs);
      };
      reader.readAsText(file);
    }
  };

  // Handle Input Uploads
  const handleVideoUpload = (e) => processVideoFile(e.target.files[0]);
  const handleSrtUpload = (e) => processSrtFile(e.target.files[0]);

  // Drag and Drop Handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    // Only set dragging to false if we are leaving the main window area
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.srt')) {
        processSrtFile(file);
      } else if (file.type.startsWith('video/') || fileName.endsWith('.mkv')) {
        processVideoFile(file);
      }
    });
  };

  // Video time update for seeking/scrubbing while paused
  const handleTimeUpdate = () => {
    if (videoRef.current && videoRef.current.paused) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Jump to subtitle
  const jumpToSubtitle = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play().catch(e => console.log("Auto-play prevented"));
    }
  };

  // Adjust individual subtitle timing
  const adjustTime = (index, field, deltaSeconds) => {
    const newSubs = [...subtitles];
    const sub = newSubs[index];
    sub[field] = Math.max(0, sub[field] + deltaSeconds);
    
    // Ensure start isn't greater than end
    if (field === 'start' && sub.start > sub.end) sub.end = sub.start + 0.5;
    if (field === 'end' && sub.end < sub.start) sub.start = Math.max(0, sub.end - 0.5);
    
    sub.startStr = secondsToTime(sub.start);
    sub.endStr = secondsToTime(sub.end);
    setSubtitles(newSubs);
  };

  // Edit subtitle text
  const editSubtitleText = (index, newText) => {
    const newSubs = [...subtitles];
    newSubs[index].text = newText;
    setSubtitles(newSubs);
  };

  // Handle raw string changes in time inputs
  const handleTimeStringChange = (index, field, value) => {
    const newSubs = [...subtitles];
    newSubs[index][`${field}Str`] = value;
    setSubtitles(newSubs);
  };

  // Apply the manually typed time
  const applyTimeEdit = (index, field) => {
    const newSubs = [...subtitles];
    const sub = newSubs[index];
    const newSeconds = timeToSeconds(sub[`${field}Str`]);
    
    if (newSeconds !== null && !isNaN(newSeconds) && newSeconds >= 0) {
      sub[field] = newSeconds;
      // Ensure start isn't greater than end
      if (field === 'start' && sub.start > sub.end) sub.end = sub.start + 0.5;
      if (field === 'end' && sub.end < sub.start) sub.start = Math.max(0, sub.end - 0.5);
    }
    
    // Reformat string to strictly match format, or revert if invalid
    sub.startStr = secondsToTime(sub.start);
    sub.endStr = secondsToTime(sub.end);
    
    setSubtitles(newSubs);
  };

  // Global Time Shift
  const applyGlobalShift = () => {
    if (globalShiftMs === 0) return;
    const deltaSeconds = globalShiftMs / 1000;
    
    const newSubs = subtitles.map(sub => {
      const newStart = Math.max(0, sub.start + deltaSeconds);
      const newEnd = Math.max(0, sub.end + deltaSeconds);
      return {
        ...sub,
        start: newStart,
        end: newEnd,
        startStr: secondsToTime(newStart),
        endStr: secondsToTime(newEnd)
      };
    });
    setSubtitles(newSubs);
    setGlobalShiftMs(0); // Reset after apply
  };

  // Export SRT
  const exportSrt = () => {
    if (subtitles.length === 0) return;
    const srtString = stringifySRT(subtitles);
    const blob = new Blob([srtString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = srtFile ? `synced_${srtFile.name}` : 'synced_subtitles.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Find active subtitles
  const activeSubtitles = subtitles.filter(
    sub => currentTime >= sub.start && currentTime <= sub.end
  );

  return (
    <div 
      className="h-screen w-full bg-slate-900 text-slate-200 flex flex-col font-sans overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm border-4 border-dashed border-indigo-500 m-4 rounded-2xl flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-20 h-20 text-indigo-400 mb-6 animate-bounce" />
          <h2 className="text-3xl font-bold text-white tracking-wide">Drop Files Here</h2>
          <p className="text-slate-400 mt-4 text-lg">Drop video (.mp4, .mkv) or subtitle (.srt) files</p>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center space-x-3">
          <Clock className="text-indigo-500 w-6 h-6" />
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
            SubSync Pro
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          <input type="file" accept="video/*,.mkv" ref={fileInputVideo} className="hidden" onChange={handleVideoUpload} />
          <input type="file" accept=".srt" ref={fileInputSrt} className="hidden" onChange={handleSrtUpload} />
          {saveStatus && (
            <span className="text-xs text-emerald-400 font-medium transition-opacity duration-300">
              {saveStatus}
            </span>
          )}
          <button onClick={() => fileInputVideo.current.click()} className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700">
            <Video className="w-4 h-4 text-cyan-400" />
            <span>Load Video</span>
          </button>
          
          <button onClick={() => fileInputSrt.current.click()} className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>Load SRT</span>
          </button>

          

          <button 
            onClick={exportSrt} 
            disabled={subtitles.length === 0}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              subtitles.length > 0 ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Export SRT</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        
        {/* Left Panel: Video & Global Controls */}
        <section className="flex-1 flex flex-col min-w-0 bg-slate-950/50">
          <div className="flex-1 p-6 flex flex-col items-center justify-center min-h-0">
            {videoUrl ? (
              <div className="flex flex-col items-center w-full max-w-4xl shrink-0">
                <div className="w-full relative group rounded-xl overflow-hidden shadow-2xl bg-black border border-slate-800">
                  <video 
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full aspect-video outline-none"
                    controls
                    onTimeUpdate={handleTimeUpdate}
                  />
                  
                  {/* On-video Subtitle Overlay */}
                  {activeSubtitles.length > 0 && (
                    <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center pointer-events-none">
                      {activeSubtitles.map(sub => (
                        <div key={`overlay-${sub.id}`} className="bg-black/80 px-4 py-2 rounded mb-1 max-w-2xl text-center">
                          <span className="text-white text-lg font-medium drop-shadow-md whitespace-pre-wrap">{sub.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Current Video Time Display */}
                <div className="mt-4 flex items-center space-x-3 bg-slate-900/80 backdrop-blur px-5 py-2.5 rounded-xl border border-slate-800 shadow-lg">
                  <Clock className="w-5 h-5 text-indigo-400" />
                  <span className="text-sm text-slate-400 font-medium uppercase tracking-wider">Video Time</span>
                  <div className="h-4 w-px bg-slate-700"></div>
                  <span className="font-mono text-xl font-semibold text-white tracking-wider">
                    {secondsToTime(currentTime)}
                  </span>
                </div>
              </div>
            ) : (
              <div 
                className="w-full max-w-4xl aspect-video rounded-xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 bg-slate-900/50 hover:bg-slate-800/50 hover:border-slate-500 transition-all cursor-pointer"
                onClick={() => fileInputVideo.current.click()}
              >
                <Video className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-lg text-slate-300">No video loaded</p>
                <p className="mt-2 text-sm text-slate-500">
                  Click to select or <span className="text-indigo-400">drag and drop</span> a video here
                </p>
              </div>
            )}
          </div>

          {/* Global Tools Panel */}
          {subtitles.length > 0 && (
            <div className="h-40 border-t border-slate-800 bg-slate-900 p-6 flex flex-col justify-center">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Global Timing Shift</h3>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 bg-slate-950 border border-slate-800 rounded-lg p-1">
                  <button onClick={() => setGlobalShiftMs(prev => prev - 100)} className="p-2 hover:bg-slate-800 rounded text-rose-400" title="Decrease by 100ms">
                    <Rewind className="w-4 h-4" />
                  </button>
                  <input 
                    type="number" 
                    value={globalShiftMs} 
                    onChange={(e) => setGlobalShiftMs(Number(e.target.value))}
                    className="w-24 bg-transparent text-center outline-none font-mono text-sm"
                  />
                  <span className="text-slate-500 text-sm">ms</span>
                  <button onClick={() => setGlobalShiftMs(prev => prev + 100)} className="p-2 hover:bg-slate-800 rounded text-emerald-400" title="Increase by 100ms">
                    <FastForward className="w-4 h-4" />
                  </button>
                </div>
                <button 
                  onClick={applyGlobalShift}
                  disabled={globalShiftMs === 0}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors border border-slate-700"
                >
                  Apply to All Subtitles
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Shift all subtitles forwards or backwards in time. Positive values delay subtitles, negative values make them appear earlier.
              </p>
            </div>
          )}
        </section>

        {/* Right Panel: Subtitle List */}
        <section className="w-[450px] border-l border-slate-800 flex flex-col bg-slate-900 z-10 shadow-xl shadow-black/50">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
            <h2 className="font-semibold text-slate-300 flex items-center space-x-2">
              <FileText className="w-4 h-4" />
              <span>Subtitle Track</span>
            </h2>
            <span className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded">
              {subtitles.length} segments
            </span>
          </div>
          
          <div 
            className="flex-1 overflow-y-auto p-4 space-y-3"
            ref={subtitleListRef}
          >
            {subtitles.length > 0 ? subtitles.map((sub, index) => {
              const isActive = currentTime >= sub.start && currentTime <= sub.end;
              return (
                <div 
                  key={index} 
                  id={`sub-${index}`}
                  className={`group rounded-xl border p-3 transition-all ${
                    isActive 
                      ? 'bg-indigo-900/20 border-indigo-500/50 shadow-lg shadow-indigo-900/20' 
                      : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3 text-xs font-mono text-slate-400">
                    <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">#{index + 1}</span>
                    <button 
                      onClick={() => jumpToSubtitle(sub.start)}
                      className="flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Play className="w-3 h-3" />
                      <span>Jump</span>
                    </button>
                  </div>

                  {/* Timing Controls */}
                  <div className="flex items-center space-x-4 mb-3">
                    {/* Start Time */}
                    <div className="flex-1 flex flex-col space-y-1">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Start</span>
                      <div className="flex items-center justify-between bg-slate-900 rounded border border-slate-800 px-1 py-1">
                        <button onClick={() => adjustTime(index, 'start', -0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white" title="-100ms">
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                        <input 
                          type="text"
                          value={sub.startStr}
                          onChange={(e) => handleTimeStringChange(index, 'start', e.target.value)}
                          onBlur={() => applyTimeEdit(index, 'start')}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="font-mono text-xs bg-transparent text-center w-[90px] outline-none text-slate-200 focus:bg-slate-800 focus:ring-1 focus:ring-indigo-500 rounded py-0.5 transition-all"
                        />
                        <button onClick={() => adjustTime(index, 'start', 0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white" title="+100ms">
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* End Time */}
                    <div className="flex-1 flex flex-col space-y-1">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">End</span>
                      <div className="flex items-center justify-between bg-slate-900 rounded border border-slate-800 px-1 py-1">
                        <button onClick={() => adjustTime(index, 'end', -0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white" title="-100ms">
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                        <input 
                          type="text"
                          value={sub.endStr}
                          onChange={(e) => handleTimeStringChange(index, 'end', e.target.value)}
                          onBlur={() => applyTimeEdit(index, 'end')}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="font-mono text-xs bg-transparent text-center w-[90px] outline-none text-slate-200 focus:bg-slate-800 focus:ring-1 focus:ring-indigo-500 rounded py-0.5 transition-all"
                        />
                        <button onClick={() => adjustTime(index, 'end', 0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white" title="+100ms">
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Text Edit */}
                  <textarea
                    value={sub.text}
                    onChange={(e) => editSubtitleText(index, e.target.value)}
                    className={`w-full bg-slate-900 border rounded p-2 text-sm text-slate-200 outline-none resize-none transition-colors ${
                      isActive ? 'border-indigo-500/50' : 'border-slate-800 focus:border-indigo-500/50'
                    }`}
                    rows={sub.text.split('\n').length}
                  />
                </div>
              );
            }) : (
              <div 
                className="h-full flex flex-col items-center justify-center text-slate-500 p-8 text-center space-y-4 cursor-pointer hover:bg-slate-800/30 rounded-xl transition-colors"
                onClick={() => fileInputSrt.current.click()}
              >
                <FileText className="w-12 h-12 opacity-30 text-emerald-400" />
                <div>
                  <p className="text-slate-300 font-medium">Upload an SRT file</p>
                  <p className="text-sm mt-1">Click to select or <span className="text-emerald-400">drag & drop</span></p>
                </div>
              </div>
            )}
          </div>
        </section>
        
      </main>
    </div>
  );
}
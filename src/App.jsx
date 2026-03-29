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
  Target,
  AlertTriangle,
  X,
  Plus,
  Trash2,
  Undo2,
  Sparkles,
  Loader2,
  Activity,
  Cpu
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
  const blocks = srtText.trim().replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const parsed = [];
  const warnings = new Set(); 

  blocks.forEach((block) => {
    const lines = block.split('\n');
    const timeLineIndex = lines.findIndex(line => line.includes('-->'));
    
    if (timeLineIndex !== -1) {
      let id = '';
      if (timeLineIndex > 0) {
        id = lines[0].trim();
      } else {
        warnings.add("Missing subtitle IDs were automatically recovered.");
      }

      const timeLine = lines[timeLineIndex];
      const timeMatch = timeLine.match(/(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3})/);
      
      if (timeMatch) {
        if (timeMatch[1].includes('.') || timeMatch[2].includes('.')) {
          warnings.add("Decimal points in timestamps were converted to commas.");
        }
        
        const startStrRaw = timeMatch[1].replace('.', ',');
        const endStrRaw = timeMatch[2].replace('.', ',');
        
        const standardFormatRegex = /^\d{2}:\d{2}:\d{2},\d{3}$/;
        if (!standardFormatRegex.test(startStrRaw) || !standardFormatRegex.test(endStrRaw)) {
          warnings.add("Non-standard timestamps (e.g. missing zeros) were standardized.");
        }

        const startSecs = timeToSeconds(startStrRaw) || 0;
        const endSecs = timeToSeconds(endStrRaw) || 0;
        
        const text = lines.slice(timeLineIndex + 1).join('\n');
        
        parsed.push({
          id,
          start: startSecs,
          end: endSecs,
          text,
          startStr: secondsToTime(startSecs),
          endStr: secondsToTime(endSecs)
        });
      }
    }
  });
  return { parsed, warnings: Array.from(warnings) };
};

const stringifySRT = (subtitles) => {
  return subtitles.map((sub, index) => {
    const startStr = secondsToTime(sub.start);
    const endStr = secondsToTime(sub.end);
    return `${index + 1}\n${startStr} --> ${endStr}\n${sub.text}`;
  }).join('\n\n') + '\n';
};

// --- Web Worker for Chunked Streaming Whisper AI ---
const whisperWorkerCode = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.0/dist/transformers.min.js';
env.allowLocalModels = false;

let transcriber = null;
let currentModelName = null;

self.onmessage = async (e) => {
  const { audio, language, modelName } = e.data;
  
  try {
    // If the model changed or hasn't been loaded yet, download it.
    if (!transcriber || currentModelName !== modelName) {
      self.postMessage({ status: 'loading', message: \`Downloading \${modelName.split('/')[1]} (only happens once)...\` });
      transcriber = await pipeline('automatic-speech-recognition', modelName, {
        progress_callback: (info) => {
          self.postMessage({ status: 'progress', info });
        }
      });
      currentModelName = modelName;
    }

    self.postMessage({ status: 'extracting', message: 'Preparing audio chunks...' });
    
    const sampleRate = 16000;
    const chunkSizeSec = 30;
    const chunkSize = chunkSizeSec * sampleRate;
    const totalChunks = Math.ceil(audio.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
        const startIdx = i * chunkSize;
        const endIdx = Math.min((i + 1) * chunkSize, audio.length);
        const audioChunk = audio.slice(startIdx, endIdx);
        
        self.postMessage({ 
            status: 'processing_chunk', 
            current: i + 1, 
            total: totalChunks, 
            message: \`Transcribing chunk \${i + 1} of \${totalChunks}...\` 
        });
        
        const result = await transcriber(audioChunk, {
            language: language,
            task: 'transcribe',
            return_timestamps: true,
            repetition_penalty: 1.15 // <-- Prevents the "ongaku" infinite loops!
        });
        
        const timeOffset = i * chunkSizeSec;
        
        if (result.chunks) {
            const adjustedChunks = result.chunks.map(c => {
                const cStart = c.timestamp[0];
                const cEnd = c.timestamp[1] !== null ? c.timestamp[1] : cStart + 2.0;
                return {
                    text: c.text,
                    start: cStart + timeOffset,
                    end: cEnd + timeOffset
                };
            });
            self.postMessage({ status: 'chunk_result', chunks: adjustedChunks });
        } else if (result.text && result.text.trim().length > 0) {
            self.postMessage({ status: 'chunk_result', chunks: [{
                text: result.text,
                start: timeOffset,
                end: timeOffset + 30.0
            }]});
        }
    }

    self.postMessage({ status: 'complete', message: 'Transcription finished!' });
  } catch (error) {
    self.postMessage({ status: 'error', error: error.message });
  }
};
`;

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
  const [parseWarnings, setParseWarnings] = useState([]);
  const [lastDeleted, setLastDeleted] = useState(null);
  const [deletedTimeout, setDeletedTimeout] = useState(null);
  
  // Streaming Transcription States
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('english');
  const [selectedModel, setSelectedModel] = useState('Xenova/whisper-base'); // Base is the new default
  const [transcribingJob, setTranscribingJob] = useState(null); 
  const workerRef = useRef(null);
  
  const videoRef = useRef(null);
  const subtitleListRef = useRef(null);
  const fileInputVideo = useRef(null);
  const fileInputSrt = useRef(null);

  // --- Autosave Effects ---
  useEffect(() => {
    const savedData = localStorage.getItem('subsync_pro_autosave');
    if (savedData) {
      try {
        const { subs, fileName } = JSON.parse(savedData);
        if (subs && subs.length > 0) {
          setSubtitles(subs);
          if (fileName) {
            setSrtFile({ name: fileName });
          }
        }
      } catch (e) {
        console.error("Failed to load autosave", e);
      }
    }

    return () => {
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  useEffect(() => {
    if (subtitles.length > 0) {
      const dataToSave = {
        subs: subtitles,
        fileName: srtFile ? srtFile.name : 'synced_subtitles.srt'
      };
      localStorage.setItem('subsync_pro_autosave', JSON.stringify(dataToSave));
      setSaveStatus('Autosaved');
      const timer = setTimeout(() => setSaveStatus(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [subtitles, srtFile]);

  // --- Video Tracking ---
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setCurrentTime(videoRef.current.currentTime);
      }
    }, 40); 
    return () => clearInterval(intervalId);
  }, []);

  // --- Handlers ---
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
        const { parsed, warnings } = parseSRT(event.target.result);
        setSubtitles(parsed);
        
        if (warnings.length > 0) {
          setParseWarnings(warnings);
          setTimeout(() => setParseWarnings([]), 8000);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleVideoUpload = (e) => processVideoFile(e.target.files[0]);
  const handleSrtUpload = (e) => processSrtFile(e.target.files[0]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
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

  const jumpToSubtitle = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play().catch(e => console.log("Auto-play prevented"));
    }
  };

  const handleJumpToCurrentFragment = () => {
    let targetSub = subtitles.find(sub => currentTime >= sub.start && currentTime <= sub.end);
    if (!targetSub) {
      targetSub = subtitles.find(sub => sub.start > currentTime);
    }
    if (targetSub) {
      const targetIndex = subtitles.indexOf(targetSub);
      jumpToSubtitle(targetSub.start);
      const el = document.getElementById(`sub-${targetIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const handleAddSubtitle = (startTimeOverride = null) => {
    let newStart = startTimeOverride !== null ? startTimeOverride : 0;
    if (startTimeOverride === null && subtitles.length > 0) {
      newStart = Math.max(...subtitles.map(s => s.end)) + 0.5;
    }
    const newEnd = newStart + 2.0;
    const newSub = {
      id: String(subtitles.length + 1),
      start: newStart,
      end: newEnd,
      text: 'New Subtitle',
      startStr: secondsToTime(newStart),
      endStr: secondsToTime(newEnd)
    };
    const newSubs = [...subtitles, newSub].sort((a, b) => a.start - b.start);
    setSubtitles(newSubs);
  };

  const handleDeleteSubtitle = (indexToRemove) => {
    const subToRemove = subtitles[indexToRemove];
    setLastDeleted({ sub: subToRemove, index: indexToRemove });
    const newSubs = subtitles.filter((_, index) => index !== indexToRemove);
    setSubtitles(newSubs);
    if (deletedTimeout) clearTimeout(deletedTimeout);
    const timer = setTimeout(() => setLastDeleted(null), 8000);
    setDeletedTimeout(timer);
  };

  const handleUndoDelete = () => {
    if (!lastDeleted) return;
    const newSubs = [...subtitles];
    const insertIndex = Math.min(lastDeleted.index, newSubs.length);
    newSubs.splice(insertIndex, 0, lastDeleted.sub);
    setSubtitles(newSubs);
    setLastDeleted(null);
    if (deletedTimeout) clearTimeout(deletedTimeout);
  };

  const adjustTime = (index, field, deltaSeconds) => {
    const newSubs = [...subtitles];
    const sub = newSubs[index];
    sub[field] = Math.max(0, sub[field] + deltaSeconds);
    if (field === 'start' && sub.start > sub.end) sub.end = sub.start + 0.5;
    if (field === 'end' && sub.end < sub.start) sub.start = Math.max(0, sub.end - 0.5);
    sub.startStr = secondsToTime(sub.start);
    sub.endStr = secondsToTime(sub.end);
    setSubtitles(newSubs);
  };

  const editSubtitleText = (index, newText) => {
    const newSubs = [...subtitles];
    newSubs[index].text = newText;
    setSubtitles(newSubs);
  };

  const handleTimeStringChange = (index, field, value) => {
    const newSubs = [...subtitles];
    newSubs[index][`${field}Str`] = value;
    setSubtitles(newSubs);
  };

  const applyTimeEdit = (index, field) => {
    const newSubs = [...subtitles];
    const sub = newSubs[index];
    const newSeconds = timeToSeconds(sub[`${field}Str`]);
    if (newSeconds !== null && !isNaN(newSeconds) && newSeconds >= 0) {
      sub[field] = newSeconds;
      if (field === 'start' && sub.start > sub.end) sub.end = sub.start + 0.5;
      if (field === 'end' && sub.end < sub.start) sub.start = Math.max(0, sub.end - 0.5);
    }
    sub.startStr = secondsToTime(sub.start);
    sub.endStr = secondsToTime(sub.end);
    setSubtitles(newSubs);
  };

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
    setGlobalShiftMs(0); 
  };

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

  // --- Auto-Transcription Streaming Logic ---
  const extractAudioFromVideo = async (file) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      return audioBuffer.getChannelData(0);
    } catch (err) {
      throw new Error("Failed to extract audio. The file might be corrupted.");
    }
  };

  const handleChunkResult = (newChunks) => {
    setSubtitles(prev => {
      const startId = prev.length + 1;
      const newSubs = newChunks.map((c, idx) => ({
        id: String(startId + idx),
        start: c.start,
        end: c.end,
        text: c.text.trim(),
        startStr: secondsToTime(c.start),
        endStr: secondsToTime(c.end)
      }));
      return [...prev, ...newSubs];
    });

    // Auto-scroll track softly
    setTimeout(() => {
      if (subtitleListRef.current) {
        subtitleListRef.current.scrollTo({
          top: subtitleListRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);
  };

  const startTranscription = async () => {
    if (!videoFile) return;
    setShowConfigModal(false);
    setTranscribingJob({ title: 'Preparing Audio', message: 'Extracting track from video...', progress: 0 });

    try {
      const audioData = await extractAudioFromVideo(videoFile);
      
      if (!workerRef.current) {
        const blob = new Blob([whisperWorkerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        workerRef.current = new Worker(workerUrl, { type: 'module' });
        
        workerRef.current.onmessage = (e) => {
          const { status, message, info, chunks, current, total, error } = e.data;
          
          if (status === 'loading') {
            setTranscribingJob(prev => ({ ...prev, title: 'Downloading Model', message: message }));
          } else if (status === 'progress') {
            if (info && info.progress) {
              setTranscribingJob(prev => ({ ...prev, progress: Math.round(info.progress) }));
            }
          } else if (status === 'extracting') {
             setTranscribingJob(prev => ({ ...prev, title: 'Processing', message: message, progress: 0 }));
          } else if (status === 'processing_chunk') {
            setTranscribingJob({ 
              title: 'Generating Subtitles', 
              message: message, 
              progress: (current / total) * 100 
            });
          } else if (status === 'chunk_result') {
            handleChunkResult(chunks);
          } else if (status === 'complete') {
            setTranscribingJob(null);
            setSaveStatus('Transcription Complete');
            setTimeout(() => setSaveStatus(''), 4000);
          } else if (status === 'error') {
            setTranscribingJob(null);
            setParseWarnings([`Transcription Error: ${error}`]);
          }
        };
      }

      workerRef.current.postMessage({
        audio: audioData,
        language: selectedLanguage,
        modelName: selectedModel // Send chosen model to the worker
      });

    } catch (err) {
      setTranscribingJob(null);
      setParseWarnings([err.message]);
    }
  };

  const cancelTranscription = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setTranscribingJob(null);
  };

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
      {/* Configuration Modal */}
      {showConfigModal && (
        <div className="absolute inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <span>Magic Transcribe</span>
              </h3>
              <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-sm text-slate-400 mb-6">
              Generate subtitles locally. You can watch the video and edit subtitles live as they stream in!
            </p>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-6 flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/90 leading-relaxed">
                <strong>Note:</strong> AI transcription cannot be 100% accurate. Please make sure to double-check the generated subtitles for accuracy.
              </p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-300">Spoken Language</label>
                <select 
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  <option value="english">English</option>
                  <option value="japanese">Japanese</option>
                  <option value="spanish">Spanish</option>
                  <option value="french">French</option>
                  <option value="german">German</option>
                  <option value="chinese">Chinese</option>
                  <option value="korean">Korean</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="flex items-center space-x-2 text-sm font-semibold text-slate-300">
                  <Cpu className="w-4 h-4 text-slate-400" />
                  <span>AI Model Accuracy</span>
                </label>
                <select 
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  <option value="Xenova/whisper-tiny">Tiny (Fastest, prone to loops)</option>
                  <option value="Xenova/whisper-base">Base (Recommended, good balance)</option>
                  <option value="Xenova/whisper-small">Small (High accuracy, slower generation)</option>
                </select>
                <p className="text-xs text-slate-500">Larger models take a bit longer to download initially but reduce hallucinations and missed words.</p>
              </div>
            </div>

            <div className="flex space-x-3">
              <button onClick={() => setShowConfigModal(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium transition-colors">
                Cancel
              </button>
              <button onClick={startTranscription} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium shadow-lg shadow-indigo-500/20 transition-all flex justify-center items-center space-x-2">
                <Activity className="w-4 h-4" />
                <span>Start Streaming</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Toast */}
      {lastDeleted && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white px-5 py-3 rounded-xl shadow-2xl border border-slate-700 flex items-center space-x-6 animate-in slide-in-from-bottom-6 fade-in duration-300">
          <span className="text-sm font-medium">Subtitle deleted.</span>
          <div className="flex items-center space-x-2 border-l border-slate-700 pl-4">
            <button 
              onClick={handleUndoDelete}
              className="flex items-center space-x-1 text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 rounded hover:bg-slate-700 transition-colors"
            >
              <Undo2 className="w-4 h-4" />
              <span>Undo</span>
            </button>
            <button onClick={() => setLastDeleted(null)} className="text-slate-400 hover:text-white transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Toast Warnings */}
      {parseWarnings.length > 0 && (
        <div className="absolute top-20 left-6 z-50 flex flex-col gap-2">
          {parseWarnings.map((warning, idx) => (
            <div key={idx} className="bg-amber-500/90 text-white px-4 py-3 rounded-lg shadow-lg shadow-amber-500/20 backdrop-blur border border-amber-400 flex items-start max-w-sm animate-in fade-in slide-in-from-top-4 transition-all">
              <AlertTriangle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-sm mb-0.5 text-amber-50">Notice</h4>
                <p className="text-xs text-amber-100">{warning}</p>
              </div>
              <button 
                onClick={() => setParseWarnings(warnings => warnings.filter((_, i) => i !== idx))} 
                className="text-amber-200 hover:text-white transition-colors ml-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-sm border-4 border-dashed border-indigo-500 m-4 rounded-2xl flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-20 h-20 text-indigo-400 mb-6 animate-bounce" />
          <h2 className="text-3xl font-bold text-white tracking-wide">Drop Files Here</h2>
          <p className="text-slate-400 mt-4 text-lg">Drop video (.mp4, .mkv) or subtitle (.srt) files</p>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-md shrink-0 z-20">
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
          
          <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <button onClick={() => fileInputSrt.current.click()} className="flex items-center space-x-2 px-4 py-2 hover:bg-slate-700 text-sm font-medium transition-colors border-r border-slate-700">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>Load SRT</span>
            </button>
            <button 
              onClick={() => setShowConfigModal(true)}
              disabled={!videoFile || transcribingJob !== null}
              className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors ${
                videoFile && !transcribingJob ? 'hover:bg-slate-700 text-indigo-300' : 'opacity-50 cursor-not-allowed text-slate-500'
              }`}
              title={videoFile ? "Auto-transcribe video" : "Load a video first to transcribe"}
            >
              <Sparkles className="w-4 h-4" />
              <span>Transcribe</span>
            </button>
          </div>

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

      {/* Transcription Active Banner */}
      {transcribingJob && (
        <div className="bg-indigo-950/80 backdrop-blur border-b border-indigo-500/30 px-6 py-2.5 flex items-center justify-between shrink-0 animate-in slide-in-from-top-2 z-10">
           <div className="flex items-center space-x-4 flex-[0.3]">
               <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
               <div className="flex flex-col">
                   <h4 className="text-sm font-semibold text-indigo-200 leading-tight">{transcribingJob.title}</h4>
                   <p className="text-xs text-indigo-300/80 truncate leading-tight mt-0.5">{transcribingJob.message}</p>
               </div>
           </div>
           
           <div className="flex-1 mx-8 flex items-center space-x-4 max-w-xl">
               <div className="flex-1 bg-slate-900/80 rounded-full h-2.5 overflow-hidden border border-indigo-900/50">
                  <div 
                    className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full transition-all duration-300 rounded-full" 
                    style={{ width: `${transcribingJob.progress || 0}%` }} 
                  />
               </div>
               <span className="text-xs text-indigo-300 font-mono w-8 text-right shrink-0">{Math.round(transcribingJob.progress || 0)}%</span>
           </div>

           <button 
              onClick={cancelTranscription} 
              className="flex items-center space-x-1 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-md text-xs font-medium transition-colors"
            >
               <X className="w-3 h-3" />
               <span>Stop</span>
           </button>
        </div>
      )}

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
                    onTimeUpdate={() => {
                      if (videoRef.current && videoRef.current.paused) setCurrentTime(videoRef.current.currentTime);
                    }}
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
                
                {/* Current Video Time Display & Controls */}
                <div className="mt-4 flex flex-row items-center space-x-4">
                  <div className="flex items-center space-x-3 bg-slate-900/80 backdrop-blur px-5 py-2.5 rounded-xl border border-slate-800 shadow-lg">
                    <Clock className="w-5 h-5 text-indigo-400" />
                    <span className="text-sm text-slate-400 font-medium uppercase tracking-wider">Time</span>
                    <div className="h-4 w-px bg-slate-700"></div>
                    <span className="font-mono text-xl font-semibold text-white tracking-wider">
                      {secondsToTime(currentTime)}
                    </span>
                  </div>

                  <button 
                    onClick={() => handleAddSubtitle(currentTime)}
                    className="flex items-center space-x-2 bg-indigo-600/20 hover:bg-indigo-600/30 px-4 py-2.5 rounded-xl border border-indigo-500/30 shadow-lg transition-colors text-indigo-300"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-sm font-medium">Add Here</span>
                  </button>

                  {subtitles.length > 0 && (
                    <button 
                      onClick={handleJumpToCurrentFragment}
                      className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 rounded-xl border border-slate-700 shadow-lg transition-colors text-slate-300"
                    >
                      <Target className="w-5 h-5 text-indigo-400" />
                      <span className="text-sm font-medium">Jump to Subtitle</span>
                    </button>
                  )}
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
            <div className="h-32 border-t border-slate-800 bg-slate-900 p-6 flex flex-col justify-center shrink-0">
              <div className="flex items-center space-x-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Global Timing Shift</h3>
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2 bg-slate-950 border border-slate-800 rounded-lg p-1">
                      <button onClick={() => setGlobalShiftMs(prev => prev - 100)} className="p-2 hover:bg-slate-800 rounded text-rose-400">
                        <Rewind className="w-4 h-4" />
                      </button>
                      <input 
                        type="number" 
                        value={globalShiftMs} 
                        onChange={(e) => setGlobalShiftMs(Number(e.target.value))}
                        className="w-20 bg-transparent text-center outline-none font-mono text-sm"
                      />
                      <span className="text-slate-500 text-sm">ms</span>
                      <button onClick={() => setGlobalShiftMs(prev => prev + 100)} className="p-2 hover:bg-slate-800 rounded text-emerald-400">
                        <FastForward className="w-4 h-4" />
                      </button>
                    </div>
                    <button 
                      onClick={applyGlobalShift}
                      disabled={globalShiftMs === 0}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors border border-slate-700"
                    >
                      Apply Shift
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Right Panel: Subtitle List */}
        <section className="w-[450px] border-l border-slate-800 flex flex-col bg-slate-900 z-10 shadow-xl shadow-black/50 shrink-0">
          <div className="p-4 border-b border-slate-800 bg-slate-950 flex justify-between items-center">
            <h2 className="font-semibold text-slate-300 flex items-center space-x-2">
              <FileText className="w-4 h-4" />
              <span>Subtitle Track</span>
            </h2>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800 mr-2">
                {subtitles.length} blocks
              </span>
              <button
                onClick={() => handleAddSubtitle(null)}
                className="p-1.5 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 hover:text-indigo-300 rounded transition-colors"
                title="Add New Subtitle"
              >
                <Plus className="w-4 h-4" />
              </button>
              {subtitles.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to clear all subtitles?")) setSubtitles([]);
                  }}
                  className="p-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 rounded transition-colors"
                  title="Clear Track"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={subtitleListRef}>
            {subtitles.length > 0 ? subtitles.map((sub, index) => {
              const isActive = currentTime >= sub.start && currentTime <= sub.end;
              return (
                <div 
                  key={sub.id + index} 
                  id={`sub-${index}`}
                  className={`group rounded-xl border p-3 transition-all ${
                    isActive 
                      ? 'bg-indigo-900/20 border-indigo-500/50 shadow-lg shadow-indigo-900/20' 
                      : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3 text-xs font-mono text-slate-400">
                    <div className="flex items-center space-x-3">
                      <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">#{index + 1}</span>
                      <button 
                        onClick={() => handleDeleteSubtitle(index)}
                        className="flex items-center space-x-1 text-rose-400 hover:text-rose-300 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
                    <div className="flex-1 flex flex-col space-y-1">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Start</span>
                      <div className="flex items-center justify-between bg-slate-900 rounded border border-slate-800 px-1 py-1">
                        <button onClick={() => adjustTime(index, 'start', -0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400">
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
                        <button onClick={() => adjustTime(index, 'start', 0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400">
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 flex flex-col space-y-1">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">End</span>
                      <div className="flex items-center justify-between bg-slate-900 rounded border border-slate-800 px-1 py-1">
                        <button onClick={() => adjustTime(index, 'end', -0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400">
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
                        <button onClick={() => adjustTime(index, 'end', 0.1)} className="p-1 hover:bg-slate-800 rounded text-slate-400">
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
                {transcribingJob ? (
                  <div className="flex flex-col items-center animate-pulse">
                    <Activity className="w-12 h-12 opacity-50 text-indigo-400 mb-4" />
                    <p className="text-indigo-300 font-medium">Listening to audio...</p>
                    <p className="text-sm mt-1">Subtitles will appear here shortly.</p>
                  </div>
                ) : (
                  <>
                    <FileText className="w-12 h-12 opacity-30 text-emerald-400" />
                    <div>
                      <p className="text-slate-300 font-medium">Upload an SRT file</p>
                      <p className="text-sm mt-1">Click to select or <span className="text-emerald-400">drag & drop</span></p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
        
      </main>
    </div>
  );
}
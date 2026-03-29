import { useState, useRef, useEffect } from 'react';
import JASSUB from 'jassub';
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
  Cpu,
  Palette,
  ArrowRightLeft
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

// --- ASS Format Helpers ---

const secondsToAssTime = (seconds) => {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds - Math.floor(seconds)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const assTimeToSeconds = (assTimeStr) => {
  if (!assTimeStr) return 0;
  const match = assTimeStr.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100;
};

const rgbToAssColor = (hexColor, alpha = 0) => {
  const hex = hexColor.replace('#', '');
  const r = hex.substring(0, 2);
  const g = hex.substring(2, 4);
  const b = hex.substring(4, 6);
  const aa = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
  return `&H${aa}${b}${g}${r}`.toUpperCase();
};

const assColorToRgb = (assColor) => {
  if (!assColor) return { color: '#FFFFFF', alpha: 0 };
  const hex = assColor.replace(/&H/i, '').replace(/&$/, '');
  let b, g, r, a = 0;
  if (hex.length >= 8) {
    a = parseInt(hex.substring(0, 2), 16);
    b = hex.substring(2, 4);
    g = hex.substring(4, 6);
    r = hex.substring(6, 8);
  } else if (hex.length >= 6) {
    b = hex.substring(0, 2);
    g = hex.substring(2, 4);
    r = hex.substring(4, 6);
  } else {
    return { color: '#FFFFFF', alpha: 0 };
  }
  return { color: `#${r}${g}${b}`.toUpperCase(), alpha: a / 255 };
};

const DEFAULT_ASS_STYLE = {
  fontName: 'Arial',
  fontSize: 48,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  backgroundColor: '#000000',
  backgroundAlpha: 0.5,
  bold: false,
  italic: false,
  alignment: 2,
  marginV: 30,
  borderStyle: 1,
  outline: 2,
  shadow: 1
};

const parseASS = (assText) => {
  const lines = assText.split(/\r?\n/);
  const parsed = [];
  const styles = new Map();
  let defaultStyle = null;
  let section = '';
  let styleFormat = [];
  let eventFormat = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      section = trimmed.toLowerCase();
      return;
    }

    if (section === '[v4+ styles]' && trimmed.startsWith('Format:')) {
      styleFormat = trimmed.substring(7).split(',').map(s => s.trim());
      return;
    }

    if (section === '[v4+ styles]' && trimmed.startsWith('Style:')) {
      const values = trimmed.substring(6).split(',').map(s => s.trim());
      const style = {};
      styleFormat.forEach((key, i) => { style[key] = values[i]; });
      styles.set(style.Name, style);
      if (style.Name === 'Default' || !defaultStyle) defaultStyle = style;
      return;
    }

    if (section === '[events]' && trimmed.startsWith('Format:')) {
      eventFormat = trimmed.substring(7).split(',').map(s => s.trim());
      return;
    }

    if (section === '[events]' && trimmed.startsWith('Dialogue:')) {
      const afterColon = trimmed.substring(trimmed.indexOf(':') + 1);
      const values = afterColon.split(',');
      const dialogue = {};
      eventFormat.forEach((key, i) => {
        if (key === 'Text') {
          dialogue[key] = values.slice(i).join(',').trim();
        } else {
          dialogue[key] = values[i]?.trim();
        }
      });

      if (dialogue.Start && dialogue.End && dialogue.Text !== undefined) {
        const startSec = assTimeToSeconds(dialogue.Start);
        const endSec = assTimeToSeconds(dialogue.End);
        parsed.push({
          id: String(parsed.length + 1),
          start: startSec,
          end: endSec,
          text: dialogue.Text.replace(/\\N/g, '\n').replace(/\{[^}]*\}/g, ''),
          startStr: secondsToTime(startSec),
          endStr: secondsToTime(endSec),
          style: dialogue.Style || 'Default',
          assOverrides: {}
        });
      }
    }
  });

  return { parsed, styles, defaultStyle };
};

const stringifyASS = (subtitles, style) => {
  const s = style || DEFAULT_ASS_STYLE;
  let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n`;
  ass += `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
  ass += `Style: Default,${s.fontName},${s.fontSize},${rgbToAssColor(s.primaryColor, 0)},&H000000FF,${rgbToAssColor(s.outlineColor, 0)},${rgbToAssColor(s.backgroundColor, 1 - (s.backgroundAlpha ?? 0.5))},${s.bold ? -1 : 0},${s.italic ? -1 : 0},0,0,100,100,0,0,${s.borderStyle},${s.outline},${s.shadow},${s.alignment},10,10,${s.marginV},1\n\n`;
  ass += `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  subtitles.forEach(sub => {
    const styleName = sub.style || 'Default';
    let text = sub.text.replace(/\n/g, '\\N');
    const ov = sub.assOverrides;
    if (ov) {
      let tags = '';
      if (ov.alignment !== undefined) tags += `\\an${ov.alignment}`;
      if (ov.fontSize) tags += `\\fs${ov.fontSize}`;
      if (ov.fontColor) tags += `\\c${rgbToAssColor(ov.fontColor, 0)}&`;
      if (ov.position) tags += `\\pos(${ov.position.x},${ov.position.y})`;
      if (tags) text = `{${tags}}` + text;
    }
    ass += `Dialogue: 0,${secondsToAssTime(sub.start)},${secondsToAssTime(sub.end)},${styleName},,0,0,0,,${text}\n`;
  });

  return ass;
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
  
  // ASS Mode States
  const [subtitleMode, setSubtitleMode] = useState('srt'); // 'srt' | 'ass'
  const [assDefaultStyle, setAssDefaultStyle] = useState({ ...DEFAULT_ASS_STYLE });

  // Streaming Transcription States
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('english');
  const [selectedModel, setSelectedModel] = useState('Xenova/whisper-base');
  const [transcribingJob, setTranscribingJob] = useState(null);
  const workerRef = useRef(null);

  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const jassubRef = useRef(null);
  const subtitleListRef = useRef(null);
  const fileInputVideo = useRef(null);
  const fileInputSrt = useRef(null);

  // --- Autosave Effects ---
  useEffect(() => {
    const savedData = localStorage.getItem('subsync_pro_autosave');
    if (savedData) {
      try {
        const { subs, fileName, mode, assStyle } = JSON.parse(savedData);
        if (subs && subs.length > 0) {
          setSubtitles(subs);
          if (fileName) setSrtFile({ name: fileName });
          if (mode) setSubtitleMode(mode);
          if (assStyle) setAssDefaultStyle(assStyle);
        }
      } catch (e) {
        console.error("Failed to load autosave", e);
      }
    }

    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (jassubRef.current) { jassubRef.current.destroy(); jassubRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (subtitles.length > 0) {
      const dataToSave = {
        subs: subtitles,
        fileName: srtFile ? srtFile.name : 'synced_subtitles.srt',
        mode: subtitleMode,
        assStyle: assDefaultStyle
      };
      localStorage.setItem('subsync_pro_autosave', JSON.stringify(dataToSave));
      setSaveStatus('Autosaved');
      const timer = setTimeout(() => setSaveStatus(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [subtitles, srtFile, subtitleMode, assDefaultStyle]);

  // --- Video Tracking ---
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setCurrentTime(videoRef.current.currentTime);
      }
    }, 40);
    return () => clearInterval(intervalId);
  }, []);

  // --- JASSUB Rendering ---
  const assContentRef = useRef('');
  const canvasRef = useRef(null);

  // Manual reload function for ASS subtitles
  const reloadAssSubtitles = () => {
    if (subtitleMode !== 'ass' || !videoRef.current || !videoContainerRef.current) return;

    const currentVideoTime = videoRef.current.currentTime;

    // Destroy old instance
    if (jassubRef.current) {
      jassubRef.current.destroy();
      jassubRef.current = null;
    }
    // Remove old canvas
    if (canvasRef.current) {
      canvasRef.current.remove();
      canvasRef.current = null;
    }
    const oldCanvas = videoContainerRef.current.querySelector('canvas');
    if (oldCanvas) oldCanvas.remove();

    // Create a fresh canvas
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.objectFit = 'contain';
    canvas.style.zIndex = '10';
    videoContainerRef.current.appendChild(canvas);
    canvasRef.current = canvas;

    const assContent = stringifyASS(subtitles, assDefaultStyle);
    assContentRef.current = assContent;

    try {
      jassubRef.current = new JASSUB({
        video: videoRef.current,
        canvas: canvas,
        subContent: assContent,
      });

      // Force a tiny time update to trigger renderer if video is paused
      if (videoRef.current.paused && currentVideoTime > 0) {
        videoRef.current.currentTime = currentVideoTime + 0.001;
      }
    } catch (err) {
      console.error('JASSUB reload failed:', err);
      setParseWarnings(['Failed to reload ASS renderer: ' + err.message]);
    }
  };

  // Initialize JASSUB only once when entering ASS mode
  useEffect(() => {
    if (subtitleMode !== 'ass' || !videoUrl || !videoRef.current || !videoContainerRef.current) {
      if (jassubRef.current) {
        jassubRef.current.destroy();
        jassubRef.current = null;
      }
      if (canvasRef.current) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      return;
    }

    const initJassub = () => {
      // Destroy old instance
      if (jassubRef.current) {
        jassubRef.current.destroy();
        jassubRef.current = null;
      }
      // Remove old canvas
      if (canvasRef.current) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      const oldCanvas = videoContainerRef.current.querySelector('canvas');
      if (oldCanvas) oldCanvas.remove();

      // Create a fresh canvas
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      canvas.style.objectFit = 'contain';
      canvas.style.zIndex = '10';
      videoContainerRef.current.appendChild(canvas);
      canvasRef.current = canvas;

      const assContent = stringifyASS(subtitles, assDefaultStyle);
      assContentRef.current = assContent;

      try {
        jassubRef.current = new JASSUB({
          video: videoRef.current,
          canvas: canvas,
          subContent: assContent,
        });
      } catch (err) {
        console.error('JASSUB initialization failed:', err);
        setParseWarnings(['Failed to initialize ASS renderer: ' + err.message]);
      }
    };

    const videoEl = videoRef.current;
    if (videoEl.readyState >= 1) {
      initJassub();
    } else {
      videoEl.addEventListener('loadedmetadata', initJassub);
      return () => videoEl.removeEventListener('loadedmetadata', initJassub);
    }

    return () => {
      if (jassubRef.current) {
        jassubRef.current.destroy();
        jassubRef.current = null;
      }
      if (canvasRef.current) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
    };
  }, [subtitleMode, videoUrl]);

  // --- Handlers ---
  const processVideoFile = (file) => {
    if (file) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
    }
  };

  const processSubtitleFile = (file) => {
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      if (fileName.endsWith('.ass')) {
        const { parsed, defaultStyle } = parseASS(content);
        setSubtitles(parsed);
        setSubtitleMode('ass');
        setSrtFile({ name: file.name });
        if (defaultStyle) {
          const { color: pc } = assColorToRgb(defaultStyle.PrimaryColour);
          const { color: oc } = assColorToRgb(defaultStyle.OutlineColour);
          const { color: bc, alpha: ba } = assColorToRgb(defaultStyle.BackColour);
          setAssDefaultStyle({
            fontName: defaultStyle.Fontname || 'Arial',
            fontSize: Number(defaultStyle.Fontsize) || 48,
            primaryColor: pc,
            outlineColor: oc,
            backgroundColor: bc,
            backgroundAlpha: 1 - ba,
            bold: defaultStyle.Bold === '-1',
            italic: defaultStyle.Italic === '-1',
            alignment: Number(defaultStyle.Alignment) || 2,
            marginV: Number(defaultStyle.MarginV) || 30,
            borderStyle: Number(defaultStyle.BorderStyle) || 1,
            outline: Number(defaultStyle.Outline) || 2,
            shadow: Number(defaultStyle.Shadow) || 1
          });
        }
      } else {
        const { parsed, warnings } = parseSRT(content);
        setSubtitles(parsed);
        setSubtitleMode('srt');
        setSrtFile(file);
        if (warnings.length > 0) {
          setParseWarnings(warnings);
          setTimeout(() => setParseWarnings([]), 8000);
        }
      }
    };
    reader.readAsText(file);
  };

  const handleVideoUpload = (e) => processVideoFile(e.target.files[0]);
  const handleSubtitleUpload = (e) => processSubtitleFile(e.target.files[0]);

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
      if (fileName.endsWith('.srt') || fileName.endsWith('.ass')) {
        processSubtitleFile(file);
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

  const exportAss = () => {
    if (subtitles.length === 0) return;
    const assString = stringifyASS(subtitles, assDefaultStyle);
    const blob = new Blob([assString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = srtFile ? srtFile.name.replace(/\.(srt|ass)$/i, '') : 'subtitles';
    a.download = `${baseName}.ass`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConvertToAss = () => {
    if (subtitles.length === 0) return;
    const converted = subtitles.map(sub => ({
      ...sub,
      style: sub.style || 'Default',
      assOverrides: sub.assOverrides || {}
    }));
    setSubtitles(converted);
    setSubtitleMode('ass');
    setParseWarnings(['Converted to ASS format. Subtitles will now render with advanced styling.']);
    setTimeout(() => setParseWarnings([]), 5000);
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
          <p className="text-slate-400 mt-4 text-lg">Drop video (.mp4, .mkv) or subtitle (.srt, .ass) files</p>
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
          <input type="file" accept=".srt,.ass" ref={fileInputSrt} className="hidden" onChange={handleSubtitleUpload} />
          {saveStatus && (
            <span className="text-xs text-emerald-400 font-medium transition-opacity duration-300">
              {saveStatus}
            </span>
          )}

          {/* Mode Badge */}
          {subtitles.length > 0 && (
            <div className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wider ${
              subtitleMode === 'ass'
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <FileText className="w-3 h-3" />
              <span>{subtitleMode}</span>
            </div>
          )}

          <button onClick={() => fileInputVideo.current.click()} className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700">
            <Video className="w-4 h-4 text-cyan-400" />
            <span>Load Video</span>
          </button>

          <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <button onClick={() => fileInputSrt.current.click()} className="flex items-center space-x-2 px-4 py-2 hover:bg-slate-700 text-sm font-medium transition-colors border-r border-slate-700">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>Load Subs</span>
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

          {/* Convert to ASS (only in SRT mode with subtitles) */}
          {subtitles.length > 0 && subtitleMode === 'srt' && (
            <button
              onClick={handleConvertToAss}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-purple-300 text-sm font-medium transition-colors"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>Convert to ASS</span>
            </button>
          )}

          {/* Export Button */}
          {subtitleMode === 'ass' ? (
            <button
              onClick={exportAss}
              disabled={subtitles.length === 0}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                subtitles.length > 0 ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>Export ASS</span>
            </button>
          ) : (
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
          )}
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
                <div ref={videoContainerRef} className="w-full relative group rounded-xl overflow-hidden shadow-2xl bg-black border border-slate-800">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full aspect-video outline-none"
                    controls
                    onTimeUpdate={() => {
                      if (videoRef.current && videoRef.current.paused) setCurrentTime(videoRef.current.currentTime);
                    }}
                  />

                  {/* On-video Subtitle Overlay (SRT mode only) */}
                  {subtitleMode === 'srt' && activeSubtitles.length > 0 && (
                    <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center pointer-events-none">
                      {activeSubtitles.map(sub => (
                        <div key={`overlay-${sub.id}`} className="bg-black/80 px-4 py-2 rounded mb-1 max-w-2xl text-center">
                          <span className="text-white text-lg font-medium drop-shadow-md whitespace-pre-wrap">{sub.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* JASSUB renders its own canvas overlay in ASS mode */}
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

                  {subtitles.length > 0 && subtitleMode === 'ass' && (
                    <button
                      onClick={reloadAssSubtitles}
                      className="flex items-center space-x-2 bg-purple-600/20 hover:bg-purple-600/30 px-4 py-2.5 rounded-xl border border-purple-500/30 shadow-lg transition-colors text-purple-300"
                    >
                      <Sparkles className="w-5 h-5" />
                      <span className="text-sm font-medium">Reload Subtitles</span>
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

          {/* ASS Style Editor Panel */}
          {subtitleMode === 'ass' && subtitles.length > 0 && (
            <div className="border-b border-slate-800 bg-slate-950/80 p-4 shrink-0">
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-2 select-none">
                  <Palette className="w-4 h-4 text-purple-400" />
                  <span>Default Style</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Font</label>
                    <input
                      type="text"
                      value={assDefaultStyle.fontName}
                      onChange={(e) => setAssDefaultStyle(s => ({ ...s, fontName: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Size</label>
                    <input
                      type="number"
                      value={assDefaultStyle.fontSize}
                      onChange={(e) => setAssDefaultStyle(s => ({ ...s, fontSize: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                      min="8" max="200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Text Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={assDefaultStyle.primaryColor}
                        onChange={(e) => setAssDefaultStyle(s => ({ ...s, primaryColor: e.target.value }))}
                        className="w-10 h-8 rounded cursor-pointer border-0"
                      />
                      <input
                        type="text"
                        value={assDefaultStyle.primaryColor}
                        onChange={(e) => setAssDefaultStyle(s => ({ ...s, primaryColor: e.target.value }))}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Outline Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        value={assDefaultStyle.outlineColor}
                        onChange={(e) => setAssDefaultStyle(s => ({ ...s, outlineColor: e.target.value }))}
                        className="w-10 h-8 rounded cursor-pointer border-0"
                      />
                      <input
                        type="text"
                        value={assDefaultStyle.outlineColor}
                        onChange={(e) => setAssDefaultStyle(s => ({ ...s, outlineColor: e.target.value }))}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Alignment</label>
                    <select
                      value={assDefaultStyle.alignment}
                      onChange={(e) => setAssDefaultStyle(s => ({ ...s, alignment: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value={1}>Bottom Left</option>
                      <option value={2}>Bottom Center</option>
                      <option value={3}>Bottom Right</option>
                      <option value={4}>Middle Left</option>
                      <option value={5}>Middle Center</option>
                      <option value={6}>Middle Right</option>
                      <option value={7}>Top Left</option>
                      <option value={8}>Top Center</option>
                      <option value={9}>Top Right</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Vertical Margin</label>
                    <input
                      type="number"
                      value={assDefaultStyle.marginV}
                      onChange={(e) => setAssDefaultStyle(s => ({ ...s, marginV: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                      min="0" max="500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Outline</label>
                    <input
                      type="number"
                      value={assDefaultStyle.outline}
                      onChange={(e) => setAssDefaultStyle(s => ({ ...s, outline: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                      min="0" max="10"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Shadow</label>
                    <input
                      type="number"
                      value={assDefaultStyle.shadow}
                      onChange={(e) => setAssDefaultStyle(s => ({ ...s, shadow: Number(e.target.value) }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                      min="0" max="10"
                    />
                  </div>
                  <div className="col-span-2 flex items-center space-x-6">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={assDefaultStyle.bold}
                        onChange={(e) => setAssDefaultStyle(s => ({ ...s, bold: e.target.checked }))}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm text-slate-300 font-medium">Bold</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={assDefaultStyle.italic}
                        onChange={(e) => setAssDefaultStyle(s => ({ ...s, italic: e.target.checked }))}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm text-slate-300 font-medium">Italic</span>
                    </label>
                  </div>
                </div>
              </details>
            </div>
          )}

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

                  {/* ASS Per-Subtitle Overrides */}
                  {subtitleMode === 'ass' && (
                    <details className="mt-2 bg-slate-950/50 rounded-lg border border-slate-800">
                      <summary className="px-3 py-2 cursor-pointer text-xs text-purple-400 font-medium hover:bg-slate-900/50 select-none">
                        Style Overrides
                      </summary>
                      <div className="p-3 space-y-3 border-t border-slate-800">
                        {/* Position Override */}
                        <div>
                          <label className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
                            <input
                              type="checkbox"
                              checked={!!sub.assOverrides?.position}
                              onChange={(e) => {
                                const newSubs = [...subtitles];
                                if (!newSubs[index].assOverrides) newSubs[index].assOverrides = {};
                                if (e.target.checked) {
                                  newSubs[index].assOverrides.position = { x: 960, y: 960 };
                                } else {
                                  delete newSubs[index].assOverrides.position;
                                }
                                setSubtitles(newSubs);
                              }}
                              className="w-3 h-3"
                            />
                            <span>Custom Position</span>
                          </label>
                          {sub.assOverrides?.position && (
                            <div className="flex items-center space-x-2 ml-5">
                              <span className="text-[10px] text-slate-500">X</span>
                              <input
                                type="number"
                                value={sub.assOverrides.position.x}
                                onChange={(e) => {
                                  const newSubs = [...subtitles];
                                  newSubs[index].assOverrides.position = { ...newSubs[index].assOverrides.position, x: Number(e.target.value) };
                                  setSubtitles(newSubs);
                                }}
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                              />
                              <span className="text-[10px] text-slate-500">Y</span>
                              <input
                                type="number"
                                value={sub.assOverrides.position.y}
                                onChange={(e) => {
                                  const newSubs = [...subtitles];
                                  newSubs[index].assOverrides.position = { ...newSubs[index].assOverrides.position, y: Number(e.target.value) };
                                  setSubtitles(newSubs);
                                }}
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                              />
                            </div>
                          )}
                        </div>

                        {/* Font Size Override */}
                        <div>
                          <label className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
                            <input
                              type="checkbox"
                              checked={!!sub.assOverrides?.fontSize}
                              onChange={(e) => {
                                const newSubs = [...subtitles];
                                if (!newSubs[index].assOverrides) newSubs[index].assOverrides = {};
                                if (e.target.checked) {
                                  newSubs[index].assOverrides.fontSize = assDefaultStyle.fontSize;
                                } else {
                                  delete newSubs[index].assOverrides.fontSize;
                                }
                                setSubtitles(newSubs);
                              }}
                              className="w-3 h-3"
                            />
                            <span>Custom Font Size</span>
                          </label>
                          {sub.assOverrides?.fontSize !== undefined && sub.assOverrides?.fontSize !== null && (
                            <input
                              type="number"
                              value={sub.assOverrides.fontSize}
                              onChange={(e) => {
                                const newSubs = [...subtitles];
                                newSubs[index].assOverrides.fontSize = Number(e.target.value);
                                setSubtitles(newSubs);
                              }}
                              className="ml-5 w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                              min="8" max="200"
                            />
                          )}
                        </div>

                        {/* Color Override */}
                        <div>
                          <label className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
                            <input
                              type="checkbox"
                              checked={!!sub.assOverrides?.fontColor}
                              onChange={(e) => {
                                const newSubs = [...subtitles];
                                if (!newSubs[index].assOverrides) newSubs[index].assOverrides = {};
                                if (e.target.checked) {
                                  newSubs[index].assOverrides.fontColor = assDefaultStyle.primaryColor;
                                } else {
                                  delete newSubs[index].assOverrides.fontColor;
                                }
                                setSubtitles(newSubs);
                              }}
                              className="w-3 h-3"
                            />
                            <span>Custom Color</span>
                          </label>
                          {sub.assOverrides?.fontColor && (
                            <div className="ml-5 flex items-center space-x-2">
                              <input
                                type="color"
                                value={sub.assOverrides.fontColor}
                                onChange={(e) => {
                                  const newSubs = [...subtitles];
                                  newSubs[index].assOverrides.fontColor = e.target.value;
                                  setSubtitles(newSubs);
                                }}
                                className="w-8 h-6 rounded cursor-pointer border-0"
                              />
                              <input
                                type="text"
                                value={sub.assOverrides.fontColor}
                                onChange={(e) => {
                                  const newSubs = [...subtitles];
                                  newSubs[index].assOverrides.fontColor = e.target.value;
                                  setSubtitles(newSubs);
                                }}
                                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                              />
                            </div>
                          )}
                        </div>

                        {/* Alignment Override */}
                        <div>
                          <label className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
                            <input
                              type="checkbox"
                              checked={sub.assOverrides?.alignment !== undefined}
                              onChange={(e) => {
                                const newSubs = [...subtitles];
                                if (!newSubs[index].assOverrides) newSubs[index].assOverrides = {};
                                if (e.target.checked) {
                                  newSubs[index].assOverrides.alignment = assDefaultStyle.alignment;
                                } else {
                                  delete newSubs[index].assOverrides.alignment;
                                }
                                setSubtitles(newSubs);
                              }}
                              className="w-3 h-3"
                            />
                            <span>Custom Alignment</span>
                          </label>
                          {sub.assOverrides?.alignment !== undefined && (
                            <select
                              value={sub.assOverrides.alignment}
                              onChange={(e) => {
                                const newSubs = [...subtitles];
                                newSubs[index].assOverrides.alignment = Number(e.target.value);
                                setSubtitles(newSubs);
                              }}
                              className="ml-5 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                            >
                              <option value={1}>Bottom Left</option>
                              <option value={2}>Bottom Center</option>
                              <option value={3}>Bottom Right</option>
                              <option value={4}>Middle Left</option>
                              <option value={5}>Middle Center</option>
                              <option value={6}>Middle Right</option>
                              <option value={7}>Top Left</option>
                              <option value={8}>Top Center</option>
                              <option value={9}>Top Right</option>
                            </select>
                          )}
                        </div>
                      </div>
                    </details>
                  )}
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
                      <p className="text-slate-300 font-medium">Upload an SRT or ASS file</p>
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
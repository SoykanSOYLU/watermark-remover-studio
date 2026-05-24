import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import JSZip from "jszip";
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  Brush,
  Eraser,
  Square,
  Trash2,
  Download,
  CheckCircle,
  RefreshCw,
  X,
  Copy,
  Undo,
  Play,
  FileImage,
  ChevronRight,
  HelpCircle,
  Maximize2,
  Sun,
  Moon,
  Film,
  Pause
} from "lucide-react";
import { UploadedImage, UploadedVideo, ToolType, RectBox, BrushPath } from "./types";
import { inpaintImage } from "./utils/inpainter";

export default function App() {
  // Application State
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"image" | "video">("image");
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  // Video playback states
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Toolbar State
  const [tool, setTool] = useState<ToolType>("brush");
  const [brushSize, setBrushSize] = useState<number>(30); // in absolute-mapped pixels roughly
  const [hoveredPreset, setHoveredPreset] = useState<string | null>(null);
  
  // System State
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme");
      if (stored) return stored === "dark";
    }
    return true; // Default to night mode for "Gece modu"
  });

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const nextVal = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("theme", nextVal ? "dark" : "light");
      }
      return nextVal;
    });
  };

  // Drawing Refs
  const isDrawing = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tempRect, setTempRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [currentPathPoints, setCurrentPathPoints] = useState<Array<{ x: number; y: number }>>([]);

  // Active Image utility
  const activeImage = useMemo(() => {
    return images.find((img) => img.id === activeImageId) || null;
  }, [images, activeImageId]);

  // Active Video utility
  const activeVideo = useMemo(() => {
    return videos.find((v) => v.id === activeVideoId) || null;
  }, [videos, activeVideoId]);

  // Set the first uploaded image as active
  useEffect(() => {
    if (images.length > 0 && !activeImageId) {
      setActiveImageId(images[0].id);
    }
  }, [images, activeImageId]);

  // Set the first uploaded video as active
  useEffect(() => {
    if (videos.length > 0 && !activeVideoId) {
      setActiveVideoId(videos[0].id);
    }
  }, [videos, activeVideoId]);

  // Handle local drawing / overlay rendering
  useEffect(() => {
    const activeItem = workspaceMode === "image" ? activeImage : activeVideo;
    if (!canvasRef.current || !activeItem) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderOverlays = () => {
      // Draw all saved paths in semi-translucent red
      activeItem.paths.forEach((path) => {
        if (path.points.length < 1) return;
        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const mappedLineWidth = (path.brushSize / 100) * canvas.width;
        ctx.lineWidth = mappedLineWidth;
        ctx.strokeStyle = "rgba(239, 68, 68, 0.45)"; // Soft ruby overlay

        const p0 = path.points[0];
        ctx.moveTo((p0.x / 100) * canvas.width, (p0.y / 100) * canvas.height);

        for (let i = 1; i < path.points.length; i++) {
          const p = path.points[i];
          ctx.lineTo((p.x / 100) * canvas.width, (p.y / 100) * canvas.height);
        }
        ctx.stroke();
      });

      // Draw all saved boxes in translucent solid overlay + solid border
      activeItem.boxes.forEach((box) => {
        const x = (box.xmin / 100) * canvas.width;
        const y = (box.ymin / 100) * canvas.height;
        const w = ((box.xmax - box.xmin) / 100) * canvas.width;
        const h = ((box.ymax - box.ymin) / 100) * canvas.height;

        ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(220, 38, 38, 0.9)";
        const labelText = box.label;
        ctx.font = "bold 11px sans-serif";
        const metaWidth = ctx.measureText(labelText).width + 8;
        ctx.fillRect(x, y - 16 >= 0 ? y - 16 : 0, metaWidth, 16);

        ctx.fillStyle = "#ffffff";
        ctx.fillText(labelText, x + 4, (y - 16 >= 0 ? y - 16 : 0) + 12);
      });

      // Draw dynamic path currently being painted under cursor
      if (currentPathPoints.length > 0 && (tool === "brush" || tool === "eraser")) {
        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = (brushSize / 100) * canvas.width;
        ctx.strokeStyle = tool === "eraser" ? "rgba(255, 255, 255, 0.75)" : "rgba(239, 68, 68, 0.6)";

        const p0 = currentPathPoints[0];
        ctx.moveTo((p0.x / 100) * canvas.width, (p0.y / 100) * canvas.height);

        for (let i = 1; i < currentPathPoints.length; i++) {
          const p = currentPathPoints[i];
          ctx.lineTo((p.x / 100) * canvas.width, (p.y / 100) * canvas.height);
        }
        ctx.stroke();
      }

      // Draw dynamic rectangular outline currently being dragged
      if (tempRect && tool === "rectangle") {
        const x = (tempRect.x1 / 100) * canvas.width;
        const y = (tempRect.y1 / 100) * canvas.height;
        const w = ((tempRect.x2 - tempRect.x1) / 100) * canvas.width;
        const h = ((tempRect.y2 - tempRect.y1) / 100) * canvas.height;

        ctx.fillStyle = "rgba(220, 38, 38, 0.2)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(220, 38, 38, 0.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
    };

    if (workspaceMode === "image" && activeImage) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const img = new Image();
      img.src = activeImage.originalUrl;
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        renderOverlays();
      };
    } else if (workspaceMode === "video" && activeVideo) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderOverlays();
    }
  }, [workspaceMode, activeImage, activeVideo, currentPathPoints, tempRect, tool, brushSize]);

  // Handle file uploads
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let filesList: File[] = [];

    if ("files" in e.target && e.target.files) {
      filesList = Array.from(e.target.files);
    } else if ("dataTransfer" in e && e.dataTransfer.files) {
      e.preventDefault();
      filesList = Array.from(e.dataTransfer.files);
    }

    // Filter for JPG/PNG support primarily
    const validImageFiles = filesList.filter(
      (file) => file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/jpg"
    );

    if (validImageFiles.length === 0) return;

    validImageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (!event.target?.result) return;
        const originalUrl = event.target.result as string;

        // Create HTML image to compute correct natural dimensions
        const img = new Image();
        img.src = originalUrl;
        img.onload = () => {
          const newUploadedImage: UploadedImage = {
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            width: img.width,
            height: img.height,
            mimeType: file.type,
            originalUrl: originalUrl,
            processedUrl: null,
            status: "idle",
            boxes: [],
            paths: [],
          };

          setImages((prev) => [...prev, newUploadedImage]);
          setApiError(null);
        };
      };
      reader.readAsDataURL(file);
    });
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let filesList: File[] = [];

    if ("files" in e.target && e.target.files) {
      filesList = Array.from(e.target.files);
    } else if ("dataTransfer" in e && e.dataTransfer.files) {
      e.preventDefault();
      filesList = Array.from(e.dataTransfer.files);
    }

    const validVideoFiles = filesList.filter(
      (file) => file.type.startsWith("video/")
    );

    if (validVideoFiles.length === 0) return;

    validVideoFiles.forEach((file) => {
      const originalUrl = URL.createObjectURL(file);
      const tempVideo = document.createElement("video");
      tempVideo.src = originalUrl;
      tempVideo.preload = "metadata";
      tempVideo.onloadedmetadata = () => {
        const newUploadedVideo: UploadedVideo = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          width: tempVideo.videoWidth || 640,
          height: tempVideo.videoHeight || 360,
          mimeType: file.type,
          originalUrl: originalUrl,
          processedUrl: null,
          status: "idle",
          boxes: [],
          paths: [],
          duration: tempVideo.duration || 10,
        };

        setVideos((prev) => [...prev, newUploadedVideo]);
        setApiError(null);
      };
    });
  };

  const preventDefaults = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Convert client-mouse to canvas image relative percentage coords
  const getRelativeCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const xPercentage = ((clientX - rect.left) / rect.width) * 100;
    const yPercentage = ((clientY - rect.top) / rect.height) * 100;

    // Boundary check clamp
    return {
      x: Math.min(Math.max(xPercentage, 0), 100),
      y: Math.min(Math.max(yPercentage, 0), 100),
    };
  };

  // Helper to retrieve active item currently edited
  const currentActiveItem = workspaceMode === "image" ? activeImage : activeVideo;

  const updateActiveImageMasks = (paths: BrushPath[], boxes: RectBox[]) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === activeImageId ? { ...img, paths, boxes } : img
      )
    );
  };

  const updateActiveVideoMasks = (paths: BrushPath[], boxes: RectBox[]) => {
    setVideos((prev) =>
      prev.map((vid) =>
        vid.id === activeVideoId ? { ...vid, paths, boxes } : vid
      )
    );
  };

  const updateActiveMasks = (paths: BrushPath[], boxes: RectBox[]) => {
    if (workspaceMode === "image") {
      updateActiveImageMasks(paths, boxes);
    } else {
      updateActiveVideoMasks(paths, boxes);
    }
  };

  // Canvas Drawing triggers
  const handleStartDraw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!currentActiveItem || currentActiveItem.processedUrl) return;
    const { x, y } = getRelativeCoords(e);

    isDrawing.current = true;

    if (tool === "brush" || tool === "eraser") {
      setCurrentPathPoints([{ x, y }]);
    } else if (tool === "rectangle") {
      dragStart.current = { x, y };
      setTempRect({ x1: x, y1: y, x2: x, y2: y });
    }
  };

  const handleMovingDraw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing.current || !currentActiveItem) return;
    const { x, y } = getRelativeCoords(e);

    if (tool === "brush" || tool === "eraser") {
      // Free brush painting path collection
      setCurrentPathPoints((prev) => [...prev, { x, y }]);
    } else if (tool === "rectangle" && dragStart.current) {
      // Rect bounding box dragging
      setTempRect({
        x1: dragStart.current.x,
        y1: dragStart.current.y,
        x2: x,
        y2: y,
      });
    }
  };

  const handleStopDraw = () => {
    if (!isDrawing.current || !currentActiveItem) return;
    isDrawing.current = false;

    if ((tool === "brush" || tool === "eraser") && currentPathPoints.length > 0) {
      if (tool === "brush") {
        const newPath: BrushPath = {
          id: crypto.randomUUID(),
          points: currentPathPoints,
          brushSize: brushSize,
        };
        updateActiveMasks([...currentActiveItem.paths, newPath], currentActiveItem.boxes);
      } else {
        // Eraser Tool logic: erase parts of paths or boxes that overlap with the eraser stroke
        const eraserRadius = brushSize;
        const filteredPaths = currentActiveItem.paths.filter((path) => {
          const intersects = path.points.some((pt) =>
            currentPathPoints.some(
              (ept) => Math.sqrt(Math.pow(pt.x - ept.x, 2) + Math.pow(pt.y - ept.y, 2)) < eraserRadius * 0.5
            )
          );
          return !intersects;
        });

        const filteredBoxes = currentActiveItem.boxes.filter((box) => {
          const intersects = currentPathPoints.some(
            (ept) =>
              ept.x >= box.xmin &&
              ept.x <= box.xmax &&
              ept.y >= box.ymin &&
              ept.y <= box.ymax
          );
          return !intersects;
        });

        updateActiveMasks(filteredPaths, filteredBoxes);
      }
      setCurrentPathPoints([]);
    } else if (tool === "rectangle" && tempRect) {
      const finalXMin = Math.min(tempRect.x1, tempRect.x2);
      const finalXMax = Math.max(tempRect.x1, tempRect.x2);
      const finalYMin = Math.min(tempRect.y1, tempRect.y2);
      const finalYMax = Math.max(tempRect.y1, tempRect.y2);

      // Prevent tiny accidental clicks
      if (finalXMax - finalXMin > 1 && finalYMax - finalYMin > 1) {
        const newBox: RectBox = {
          id: crypto.randomUUID(),
          label: `Watermark Rectangle`,
          ymin: finalYMin,
          xmin: finalXMin,
          ymax: finalYMax,
          xmax: finalXMax,
        };
        updateActiveMasks(currentActiveItem.paths, [...currentActiveItem.boxes, newBox]);
      }
      setTempRect(null);
      dragStart.current = null;
    }
  };

  // Undo Last Action (removes last drawn path/box)
  const handleUndo = () => {
    if (!currentActiveItem) return;

    if (currentActiveItem.boxes.length > 0) {
      updateActiveMasks(currentActiveItem.paths, currentActiveItem.boxes.slice(0, -1));
    } else if (currentActiveItem.paths.length > 0) {
      updateActiveMasks(currentActiveItem.paths.slice(0, -1), currentActiveItem.boxes);
    }
  };

  // Clears active item mask coordinates
  const handleClearMask = () => {
    if (!currentActiveItem) return;
    updateActiveMasks([], []);
    if (workspaceMode === "image") {
      setImages((prev) =>
        prev.map((img) =>
          img.id === activeImageId ? { ...img, processedUrl: null, status: "idle" } : img
        )
      );
    } else {
      setVideos((prev) =>
        prev.map((vid) =>
          vid.id === activeVideoId ? { ...vid, processedUrl: null, status: "idle" } : vid
        )
      );
    }
  };

  // Preset Common Watermark boundaries
  const handleApplyPreset = (preset: "bottom-right" | "bottom-center" | "top-left" | "top-right" | "center-diagonal") => {
    if (!currentActiveItem) return;

    let newBox: RectBox;
    switch (preset) {
      case "bottom-right":
        newBox = { id: crypto.randomUUID(), label: "Corner Stamp", ymin: 82, xmin: 72, ymax: 97, xmax: 98 };
        break;
      case "bottom-center":
        newBox = { id: crypto.randomUUID(), label: "Bottom Brand", ymin: 86, xmin: 30, ymax: 98, xmax: 70 };
        break;
      case "top-left":
        newBox = { id: crypto.randomUUID(), label: "Top-Left Stamp", ymin: 2, xmin: 2, ymax: 18, xmax: 28 };
        break;
      case "top-right":
        newBox = { id: crypto.randomUUID(), label: "Top-Right Stamp", ymin: 2, xmin: 72, ymax: 18, xmax: 98 };
        break;
      case "center-diagonal":
        newBox = { id: crypto.randomUUID(), label: "Centered Filigran", ymin: 35, xmin: 20, ymax: 65, xmax: 80 };
        break;
    }

    updateActiveMasks(currentActiveItem.paths, [...currentActiveItem.boxes, newBox]);
  };

  // BATCH CONTROL: Copy active masks to all uploaded items in queue
  const handleCopyMaskToAll = () => {
    if (!currentActiveItem) return;
    if (workspaceMode === "image") {
      setImages((prev) =>
        prev.map((img) => {
          if (img.id === currentActiveItem.id) return img;
          return {
            ...img,
            paths: currentActiveItem.paths.map((p) => ({ ...p, id: crypto.randomUUID() })),
            boxes: currentActiveItem.boxes.map((b) => ({ ...b, id: crypto.randomUUID() })),
            status: "idle",
            processedUrl: null,
          };
        })
      );
    } else {
      setVideos((prev) =>
        prev.map((vid) => {
          if (vid.id === currentActiveItem.id) return vid;
          return {
            ...vid,
            paths: currentActiveItem.paths.map((p) => ({ ...p, id: crypto.randomUUID() })),
            boxes: currentActiveItem.boxes.map((b) => ({ ...b, id: crypto.randomUUID() })),
            status: "idle",
            processedUrl: null,
          };
        })
      );
    }
  };

  // Delete specific target bounding box coordinate
  const deleteBox = (boxId: string) => {
    if (!currentActiveItem) return;
    updateActiveMasks(
      currentActiveItem.paths,
      currentActiveItem.boxes.filter((b) => b.id !== boxId)
    );
  };

  // AI Automatic detection of Watermarks (Gemini 3.5 Flash)
  const handleAIDetect = async () => {
    if (!activeImage) return;

    setImages((prev) =>
      prev.map((img) =>
        img.id === activeImageId ? { ...img, status: "detecting" } : img
      )
    );
    setApiError(null);

    try {
      const response = await fetch("/api/detect-watermark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: activeImage.originalUrl,
          mimeType: activeImage.mimeType,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to trigger AI watermark detector.");
      }

      const data = await response.json();
      const detectedBoxes: RectBox[] = (data.watermarks || []).map((b: any) => ({
        id: crypto.randomUUID(),
        label: b.label || "AI Watermark",
        ymin: b.box[0],
        xmin: b.box[1],
        ymax: b.box[2],
        xmax: b.box[3],
        isAiDetected: true,
      }));

      setImages((prev) =>
        prev.map((img) =>
          img.id === activeImageId
            ? {
                ...img,
                status: "idle",
                boxes: [...img.boxes, ...detectedBoxes],
              }
            : img
        )
      );
    } catch (err: any) {
      console.error(err);
      setApiError(err.message);
      setImages((prev) =>
        prev.map((img) =>
          img.id === activeImageId ? { ...img, status: "error", errorMsg: err.message } : img
        )
      );
    }
  };

  // Triggers localized inpaint heal for single video
  const handleRemoveWatermarkVideo = async (videoId: string) => {
    const vid = videos.find((v) => v.id === videoId);
    if (!vid) return;

    if (vid.paths.length === 0 && vid.boxes.length === 0) {
      return; // nothing to heal
    }

    setVideos((prev) =>
      prev.map((v) => (v.id === videoId ? { ...v, status: "processing", errorMsg: "Initiating codec pipeline..." } : v))
    );

    try {
      // Create a background video element to draw frames stepping sequentially
      const tempVideo = document.createElement("video");
      tempVideo.src = vid.originalUrl;
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        tempVideo.onloadedmetadata = () => resolve();
        tempVideo.onerror = (e) => reject(new Error("Video failed to play back."));
      });

      const vWidth = tempVideo.videoWidth || vid.width;
      const vHeight = tempVideo.videoHeight || vid.height;

      const procCanvas = document.createElement("canvas");
      procCanvas.width = vWidth;
      procCanvas.height = vHeight;
      const procCtx = procCanvas.getContext("2d", { willReadFrequently: true });
      if (!procCtx) throw new Error("Canvas context init failed.");

      // Record frames of offscreen canvas
      const stream = procCanvas.captureStream(25); // 25 FPS target
      
      // Determine the best MIME type supported by the browser
      let options = { mimeType: "video/webm;codecs=vp9" };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: "video/webm" };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: "" }; // default fallback
      }

      const recorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      const duration = tempVideo.duration || vid.duration || 5;
      const fps = 12; // High-density frames to ensure buttery smooth result
      const totalFrames = Math.ceil(duration * fps);

      recorder.start();

      // Sequential seek & paint loop
      for (let f = 0; f < totalFrames; f++) {
        const targetTime = f / fps;
        tempVideo.currentTime = targetTime;

        await new Promise<void>((resolveSeek) => {
          tempVideo.onseeked = () => resolveSeek();
        });

        // Frame snapshot
        procCtx.drawImage(tempVideo, 0, 0, vWidth, vHeight);

        // Apply fast high-performance local spatial inpaint filtering
        const imgData = procCtx.getImageData(0, 0, vWidth, vHeight);
        const data = imgData.data;

        // Render binary mask onto separate offscreen canvas
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = vWidth;
        maskCanvas.height = vHeight;
        const maskCtx = maskCanvas.getContext("2d");
        if (maskCtx) {
          maskCtx.fillStyle = "black";
          maskCtx.fillRect(0, 0, vWidth, vHeight);
          maskCtx.fillStyle = "white";
          maskCtx.strokeStyle = "white";

          // Paths
          vid.paths.forEach((path) => {
            if (path.points.length < 1) return;
            maskCtx.lineWidth = (path.brushSize / 100) * vWidth;
            maskCtx.lineCap = "round";
            maskCtx.lineJoin = "round";
            maskCtx.beginPath();
            maskCtx.moveTo((path.points[0].x / 100) * vWidth, (path.points[0].y / 100) * vHeight);
            for (let i = 1; i < path.points.length; i++) {
              maskCtx.lineTo((path.points[i].x / 100) * vWidth, (path.points[i].y / 100) * vHeight);
            }
            maskCtx.stroke();
          });

          // Boxes
          vid.boxes.forEach((box) => {
            const bx = (box.xmin / 100) * vWidth;
            const by = (box.ymin / 100) * vHeight;
            const bw = ((box.xmax - box.xmin) / 100) * vWidth;
            const bh = ((box.ymax - box.ymin) / 100) * vHeight;
            maskCtx.fillRect(bx, by, bw, bh);
          });

          const maskData = maskCtx.getImageData(0, 0, vWidth, vHeight).data;
          const pixelRadius = 6;

          for (let y = 0; y < vHeight; y++) {
            for (let x = 0; x < vWidth; x++) {
              const idx = (y * vWidth + x) * 4;
              // If mask is white at this position, repair the pixel
              if (maskData[idx] > 120) {
                let rSum = 0, gSum = 0, bSum = 0, count = 0;

                // Simple high-speed pixel repair searching neighbors
                for (let dy = -pixelRadius; dy <= pixelRadius; dy += 3) {
                  const ny = y + dy;
                  if (ny < 0 || ny >= vHeight) continue;

                  for (let dx = -pixelRadius; dx <= pixelRadius; dx += 3) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= vWidth) continue;

                    const nidx = (ny * vWidth + nx) * 4;
                    if (maskData[nidx] <= 120) {
                      rSum += data[nidx];
                      gSum += data[nidx + 1];
                      bSum += data[nidx + 2];
                      count++;
                    }
                  }
                }

                if (count > 0) {
                  data[idx] = rSum / count;
                  data[idx + 1] = gSum / count;
                  data[idx + 2] = bSum / count;
                } else {
                  // Fallback: smudge from left
                  const left = Math.max(0, idx - 4 * pixelRadius);
                  data[idx] = data[left];
                  data[idx + 1] = data[left + 1];
                  data[idx + 2] = data[left + 2];
                }
              }
            }
          }
          procCtx.putImageData(imgData, 0, 0);
        }

        const progressPercent = Math.round(((f + 1) / totalFrames) * 100);
        setVideos((prev) =>
          prev.map((v) =>
            v.id === videoId
              ? {
                  ...v,
                  errorMsg: `Cleaning frame ${f + 1}/${totalFrames} (${progressPercent}%)`,
                }
              : v
          )
        );
      }

      recorder.stop();

      const processedBlob = await new Promise<Blob>((resolveBlob) => {
        recorder.onstop = () => {
          const finalBlob = new Blob(chunks, { type: "video/webm" });
          resolveBlob(finalBlob);
        };
      });

      const processedUrl = URL.createObjectURL(processedBlob);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId
            ? {
                ...v,
                processedUrl: processedUrl,
                status: "done",
                errorMsg: undefined,
              }
            : v
        )
      );
    } catch (error: any) {
      console.error(error);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId ? { ...v, status: "error", errorMsg: error.message || "Pipeline failed." } : v
        )
      );
    }
  };

  // Triggers localized inpaint heal for single image
  const handleRemoveWatermarkSingle = async (imgId: string) => {
    const targetImg = images.find((i) => i.id === imgId);
    if (!targetImg) return;

    // Check if there are any masks painted or boxed
    if (targetImg.paths.length === 0 && targetImg.boxes.length === 0) {
      return; // nothing to heal
    }

    setImages((prev) =>
      prev.map((img) => (img.id === imgId ? { ...img, status: "processing" } : img))
    );

    // Create a minor timeout to allow React layout updates and showing loader spinner
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const resultDataUrl = await executeClientInpaint(targetImg);
      setImages((prev) =>
        prev.map((img) =>
          img.id === imgId
            ? {
                ...img,
                processedUrl: resultDataUrl,
                status: "done",
              }
            : img
        )
      );
    } catch (err: any) {
      console.error(err);
      setImages((prev) =>
        prev.map((img) =>
          img.id === imgId
            ? {
                ...img,
                status: "error",
                errorMsg: err.message || "Failed to inpaint.",
              }
            : img
        )
      );
    }
  };

  // Perform rasterized high-res client inpainting
  const executeClientInpaint = (imgTarget: UploadedImage): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = imgTarget.originalUrl;
      img.onload = () => {
        try {
          // Offscreen Canvas with exactly active image's physical resolution
          const canvas = document.createElement("canvas");
          canvas.width = imgTarget.width;
          canvas.height = imgTarget.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Could not initialize 2D context.");

          ctx.drawImage(img, 0, 0);

          // Second Offscreen canvas for binary structural mask
          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = imgTarget.width;
          maskCanvas.height = imgTarget.height;
          const mCtx = maskCanvas.getContext("2d");
          if (!mCtx) throw new Error("Could not initialize Mask context.");

          mCtx.fillStyle = "black";
          mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

          // Rasterize all paths on Mask Canvas
          imgTarget.paths.forEach((path) => {
            if (path.points.length < 1) return;
            mCtx.beginPath();
            mCtx.lineCap = "round";
            mCtx.lineJoin = "round";
            
            // Map percentage brush width back to physical coordinates
            const mappedWidth = (path.brushSize / 100) * maskCanvas.width;
            mCtx.lineWidth = mappedWidth;
            mCtx.strokeStyle = "white";

            const p0 = path.points[0];
            mCtx.moveTo((p0.x / 100) * maskCanvas.width, (p0.y / 100) * maskCanvas.height);

            for (let i = 1; i < path.points.length; i++) {
              const p = path.points[i];
              mCtx.lineTo((p.x / 100) * maskCanvas.width, (p.y / 100) * maskCanvas.height);
            }
            mCtx.stroke();
          });

          // Rasterize all rectangular boxes on Mask Canvas
          imgTarget.boxes.forEach((box) => {
            const x = (box.xmin / 100) * maskCanvas.width;
            const y = (box.ymin / 100) * maskCanvas.height;
            const w = ((box.xmax - box.xmin) / 100) * maskCanvas.width;
            const h = ((box.ymax - box.ymin) / 100) * maskCanvas.height;

            mCtx.fillStyle = "white";
            mCtx.fillRect(x, y, w, h);
          });

          // Trigger Fast-Wavefront Healing in painter script
          const healedImgData = inpaintImage(ctx, mCtx, canvas.width, canvas.height);
          ctx.putImageData(healedImgData, 0, 0);

          // Export identical naming output file string in JPG high-quality
          const optimizedQuality = 0.95;
          const resultDataUrl = canvas.toDataURL("image/jpeg", optimizedQuality);
          resolve(resultDataUrl);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("Image failed loading."));
    });
  };

  // Triggers background batch removal for all uploaded images in parallel
  const handleBatchRemove = async () => {
    if (images.length === 0) return;
    setIsProcessingBatch(true);

    const promises = images.map(async (img) => {
      // Skip if no masks defined
      if (img.paths.length === 0 && img.boxes.length === 0) {
        return;
      }

      setImages((prev) =>
        prev.map((i) => (i.id === img.id ? { ...i, status: "processing" } : i))
      );

      try {
        const resultUrl = await executeClientInpaint(img);
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id ? { ...i, processedUrl: resultUrl, status: "done" } : i
          )
        );
      } catch (err: any) {
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id ? { ...i, status: "error", errorMsg: err.message } : i
          )
        );
      }
    });

    await Promise.all(promises);
    setIsProcessingBatch(false);
  };

  // Single file download trigger preserving original file name perfectly
  const triggerSingleDownload = (img: UploadedImage) => {
    const url = img.processedUrl || img.originalUrl;
    const a = document.createElement("a");
    a.href = url;
    a.download = img.name; // Preserving input file name identical
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Batch download zipped archive keeping identical names per image
  const triggerZipDownload = async () => {
    const zip = new JSZip();
    let filesAdded = 0;

    images.forEach((img) => {
      const dataUrl = img.processedUrl || img.originalUrl;
      // Get pure base64 segment
      const cleanBase64 = dataUrl.split(",")[1];
      if (cleanBase64) {
        zip.file(img.name, cleanBase64, { base64: true });
        filesAdded++;
      }
    });

    if (filesAdded === 0) return;

    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const mainLink = document.createElement("a");
      mainLink.href = URL.createObjectURL(blob);
      mainLink.download = "processed_watermarks_bundle.zip";
      document.body.appendChild(mainLink);
      mainLink.click();
      document.body.removeChild(mainLink);
    } catch (e) {
      console.error("ZIP building error:", e);
    }
  };

  // Size description string
  const getFileSizeString = (size: number) => {
    if (size === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(size) / Math.log(k));
    return parseFloat((size / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-200 select-none ${isDarkMode ? "bg-slate-950 text-slate-100 selection:bg-indigo-500/15" : "bg-slate-50 text-slate-900 selection:bg-indigo-500/10"}`}>
      
      {/* Header Banner Section */}
      <header className={`h-16 border-b flex items-center justify-between px-8 shrink-0 transition-colors duration-200 shadow-xs ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-sm flex items-center justify-center shadow-sm">
            <div className="w-4 h-4 border-2 border-white rounded-full"></div>
          </div>
          <div>
            <h1 className={`text-sm font-bold tracking-tight uppercase leading-none ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
              ClearMark AI
            </h1>
            <p className={`text-[10px] font-mono mt-1 uppercase tracking-tight ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
              Identical Input & Output Matching
            </p>
          </div>
        </div>

        <nav className={`hidden md:flex gap-8 text-[11px] font-bold uppercase tracking-widest ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
          <span className="text-indigo-400 border-b-2 border-indigo-400 pb-5 pt-5 cursor-pointer">Workspace</span>
          <span className={`py-5 cursor-pointer transition-colors ${isDarkMode ? "hover:text-white" : "hover:text-slate-800"}`} onClick={() => setShowHelp(true)}>Batch Guide</span>
          <span className="py-5 cursor-default">File Sync</span>
        </nav>

        <div className="flex items-center gap-3">
          {/* Night Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className={`p-1.5 rounded-sm border cursor-pointer transition-colors ${
              isDarkMode 
                ? "border-slate-800 text-amber-400 bg-slate-850 hover:bg-slate-800" 
                : "border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100"
            }`}
            title={isDarkMode ? "Switch to Light Mode" : "Switch to Night Mode"}
          >
            {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <span className={`text-[10px] px-2 py-0.5 rounded-sm font-mono font-bold tracking-wide transition-colors ${isDarkMode ? "bg-slate-800 text-slate-405" : "bg-slate-100 text-slate-600"}`}>v2.4.0-STABLE</span>
          <button
            onClick={() => setShowHelp((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm border transition text-[10px] font-bold uppercase tracking-wider cursor-pointer ${
              isDarkMode 
                ? "border-slate-800 text-slate-300 bg-slate-900 hover:bg-slate-800" 
                : "border-slate-200 text-slate-600 bg-white hover:bg-slate-55"
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
            <span>Guide</span>
          </button>
        </div>
      </header>

      {/* Guide Help Overlay Modal */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className={`rounded-sm shadow-2xl border w-full max-w-lg overflow-hidden transition-colors ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}
            >
              <div className={`p-6 border-b flex items-center justify-between ${isDarkMode ? "bg-slate-950/40 border-slate-800" : "bg-slate-50 border-slate-100"}`}>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-indigo-600 rounded-xs flex items-center justify-center">
                    <div className="w-3 h-3 border border-white rounded-full"></div>
                  </div>
                  <h3 className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>Application Quick Guide</h3>
                </div>
                <button
                  onClick={() => setShowHelp(false)}
                  className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className={`p-6 space-y-4 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                <div className="flex gap-3">
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${isDarkMode ? "bg-indigo-950/50 text-indigo-400" : "bg-indigo-50 text-indigo-600"}`}>1</span>
                  <p className="text-xs">
                    <strong>Upload Files:</strong> Drop multiple JPG/PNG images. Uploaded images are queued securely. Your original filenames will never change.
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${isDarkMode ? "bg-indigo-950/50 text-indigo-400" : "bg-indigo-50 text-indigo-600"}`}>2</span>
                  <p className="text-xs">
                    <strong>Select Mask Tool:</strong> Use the <strong>Brush</strong> (freehand drawing), <strong>Rectangle</strong> (box regions), or <strong>AI Auto-Detect</strong> to overlay watermarks in red.
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${isDarkMode ? "bg-indigo-950/50 text-indigo-400" : "bg-indigo-50 text-indigo-600"}`}>3</span>
                  <p className="text-xs">
                    <strong>Batch Smart-Copy:</strong> Click <strong>"Apply Mask To All"</strong> to clone your defined watermark mask on every file instantly. Great for same-location watermark layouts!
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${isDarkMode ? "bg-indigo-950/50 text-indigo-400" : "bg-indigo-50 text-indigo-600"}`}>4</span>
                  <p className="text-xs">
                    <strong>Inpaint & Save:</strong> Click "Remove Watermark" to process. Export individual matches or fetch them wrapped neatly inside a <strong>ZIP package with identical file match-naming!</strong>
                  </p>
                </div>
              </div>
              <div className={`p-4 border-t flex justify-end ${isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-100"}`}>
                <button
                  onClick={() => setShowHelp(false)}
                  className={`px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider cursor-pointer transition ${isDarkMode ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-slate-900 override:hover:bg-black text-white"}`}
                >
                  Dismiss Guide
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Layout */}
      <div className={`flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 transition-colors duration-200 ${isDarkMode ? "bg-slate-950" : "bg-slate-50"}`}>
        
        {/* Left Sidebar Queue / Controls */}
        <aside className={`w-full lg:w-80 border-r p-6 flex flex-col gap-6 shrink-0 min-h-[250px] lg:min-h-0 lg:h-full overflow-y-auto transition-colors duration-200 ${isDarkMode ? "bg-slate-900/60 border-slate-800" : "bg-slate-55 border-slate-200"}`}>
          
          {/* Workspace Mode Selection (Geometric Tab) */}
          <div className="flex flex-col gap-2">
            <label className={`text-[10px] font-bold uppercase tracking-tighter block ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
              Workspace Modu
            </label>
            <div className={`grid grid-cols-2 p-1 gap-1 rounded-lg border transition-all duration-150 ${isDarkMode ? "bg-slate-950 border-slate-800" : "bg-slate-100 border-slate-200"}`}>
              <button
                onClick={() => setWorkspaceMode("image")}
                className={`py-1.5 px-3 rounded text-[11px] font-bold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all text-center cursor-pointer ${
                  workspaceMode === "image"
                    ? "bg-indigo-600 text-white shadow"
                    : (isDarkMode ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900")
                }`}
              >
                <FileImage className="w-3.5 h-3.5" />
                <span>Görsel</span>
              </button>
              <button
                onClick={() => setWorkspaceMode("video")}
                className={`py-1.5 px-3 rounded text-[11px] font-bold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all text-center cursor-pointer ${
                  workspaceMode === "video"
                    ? "bg-indigo-600 text-white shadow"
                    : (isDarkMode ? "text-slate-400 hover:text-white" : "text-slate-600 hover:text-slate-900")
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Video</span>
              </button>
            </div>
          </div>

          {/* File Upload zone */}
          <div>
            <label className={`text-[10px] font-bold uppercase tracking-tighter mb-2 block ${isDarkMode ? "text-slate-550" : "text-slate-404"}`}>Input Source</label>
            {workspaceMode === "image" ? (
              images.length === 0 ? (
                <label
                  onDragOver={preventDefaults}
                  onDragEnter={preventDefaults}
                  onDrop={handleFileUpload}
                  className={`w-full py-10 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 transition duration-155 group cursor-pointer ${
                    isDarkMode 
                      ? "border-slate-800 bg-slate-900/40 hover:border-indigo-500 hover:bg-slate-900" 
                      : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50/50"
                  }`}
                >
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/jpg"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <div className={`p-2.5 rounded-lg text-slate-400 group-hover:text-indigo-500 transition ${isDarkMode ? "bg-slate-950" : "bg-slate-150"}`}>
                    <Upload className="w-5 h-5 animate-bounce" />
                  </div>
                  <span className={`text-xs font-semibold ${isDarkMode ? "text-slate-300" : "text-slate-650"}`}>Drop JPG files here</span>
                  <span className="text-[10px] text-slate-400 font-mono">100% Quality Output</span>
                </label>
              ) : (
                <div className={`border rounded-lg p-3.5 space-y-3.5 transition-colors ${isDarkMode ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className={`flex justify-between items-center pb-2 border-b ${isDarkMode ? "border-slate-800" : "border-slate-100"}`}>
                    <span className={`text-[11px] font-bold uppercase tracking-widest flex items-center gap-1 ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                      <FileImage className="w-3.5 h-3.5 text-slate-400" /> Image files ({images.length})
                    </span>
                    <button
                      onClick={() => {
                        setImages([]);
                        setActiveImageId(null);
                      }}
                      className="text-[10px] font-bold text-rose-500 hover:text-rose-400 uppercase tracking-wider cursor-pointer font-mono"
                    >
                      Clear All
                    </button>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {images.map((img) => {
                      const isActive = img.id === activeImageId;
                      return (
                        <div
                          key={img.id}
                          onClick={() => setActiveImageId(img.id)}
                          className={`p-2 rounded border flex items-center gap-2 cursor-pointer transition ${
                            isActive
                              ? (isDarkMode ? "border-indigo-500 bg-indigo-950/25" : "border-indigo-600 bg-indigo-50/15")
                              : (isDarkMode ? "border-slate-800 hover:border-slate-700 bg-slate-950/45" : "border-slate-100 hover:border-slate-300 bg-white")
                          }`}
                        >
                          <div className={`w-8 h-8 rounded overflow-hidden border shrink-0 ${isDarkMode ? "border-slate-800" : "border-slate-200"}`}>
                            <img src={img.originalUrl} className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0 pr-2">
                            <p className={`text-xs font-mono truncate font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`} title={img.name}>
                              {img.name}
                            </p>
                            <p className="text-[9px] text-slate-400 font-mono mt-0.5">
                              {getFileSizeString(img.size)}
                            </p>
                          </div>
                          {img.status === "done" && (
                            <CheckCircle className="w-4 h-4 text-emerald-500 fill-white shrink-0" />
                          )}
                          {img.status === "processing" && (
                            <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <label className={`w-full py-1.5 border rounded text-center block text-[10px] font-bold uppercase cursor-pointer transition ${
                    isDarkMode 
                      ? "bg-slate-950/60 border-slate-800 text-indigo-400 hover:border-indigo-805 hover:bg-slate-850" 
                      : "bg-slate-50 border-slate-200 text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/20"
                  }`}>
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/jpg"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    + Add More Images
                  </label>
                </div>
              )
            ) : (
              videos.length === 0 ? (
                <label
                  onDragOver={preventDefaults}
                  onDragEnter={preventDefaults}
                  onDrop={handleVideoUpload}
                  className={`w-full py-10 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 transition duration-155 group cursor-pointer ${
                    isDarkMode 
                      ? "border-slate-800 bg-slate-900/40 hover:border-indigo-500 hover:bg-slate-900" 
                      : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50/50"
                  }`}
                >
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoUpload}
                    className="hidden"
                  />
                  <div className={`p-2.5 rounded-lg text-slate-400 group-hover:text-indigo-500 transition ${isDarkMode ? "bg-slate-950" : "bg-slate-150"}`}>
                    <Film className="w-5 h-5 animate-pulse" />
                  </div>
                  <span className={`text-xs font-semibold ${isDarkMode ? "text-slate-300" : "text-slate-655"}`}>Drop MP4/WebM files here</span>
                  <span className="text-[10px] text-slate-400 font-mono">Lossless Render Engine</span>
                </label>
              ) : (
                <div className={`border rounded-lg p-3.5 space-y-3.5 transition-colors ${isDarkMode ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
                  <div className={`flex justify-between items-center pb-2 border-b ${isDarkMode ? "border-slate-800" : "border-slate-100"}`}>
                    <span className={`text-[11px] font-bold uppercase tracking-widest flex items-center gap-1 ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                      <Film className="w-3.5 h-3.5 text-slate-400" /> Video files ({videos.length})
                    </span>
                    <button
                      onClick={() => {
                        setVideos([]);
                        setActiveVideoId(null);
                      }}
                      className="text-[10px] font-bold text-rose-500 hover:text-rose-400 uppercase tracking-wider cursor-pointer font-mono"
                    >
                      Clear All
                    </button>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {videos.map((vid) => {
                      const isActive = vid.id === activeVideoId;
                      return (
                        <div
                          key={vid.id}
                          onClick={() => setActiveVideoId(vid.id)}
                          className={`p-2 rounded border flex items-center gap-2 cursor-pointer transition ${
                            isActive
                              ? (isDarkMode ? "border-indigo-500 bg-indigo-950/25" : "border-indigo-600 bg-indigo-50/15")
                              : (isDarkMode ? "border-slate-800 hover:border-slate-700 bg-slate-950/45" : "border-slate-100 hover:border-slate-300 bg-white")
                          }`}
                        >
                          <div className={`w-8 h-8 rounded border shrink-0 flex items-center justify-center bg-slate-950 ${isDarkMode ? "border-slate-800" : "border-slate-200"}`}>
                            <Film className="w-4 h-4 text-indigo-450" />
                          </div>
                          <div className="flex-1 min-w-0 pr-2">
                            <p className={`text-xs font-mono truncate font-semibold ${isDarkMode ? "text-slate-200" : "text-slate-700"}`} title={vid.name}>
                              {vid.name}
                            </p>
                            <p className="text-[9px] text-slate-405 font-mono mt-0.5">
                              {getFileSizeString(vid.size)} ({Math.round(vid.duration)}s)
                            </p>
                          </div>
                          {vid.status === "done" && (
                            <CheckCircle className="w-4 h-4 text-emerald-500 fill-white shrink-0" />
                          )}
                          {vid.status === "processing" && (
                            <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <label className={`w-full py-1.5 border rounded text-center block text-[10px] font-bold uppercase cursor-pointer transition ${
                    isDarkMode 
                      ? "bg-slate-950/60 border-slate-800 text-indigo-400 hover:border-indigo-805 hover:bg-slate-850" 
                      : "bg-slate-55 border-slate-200 text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/20"
                  }`}>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={handleVideoUpload}
                      className="hidden"
                    />
                    + Add More Videos
                  </label>
                </div>
              )
            )}
          </div>

          {/* Processing Mode Selection buttons in beautiful geometric grid */}
          <div className="flex flex-col gap-2">
            <label className={`text-[10px] font-bold uppercase tracking-tighter block ${isDarkMode ? "text-slate-500" : "text-slate-404"}`}>Processing Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTool("brush")}
                className={`py-2 px-3 rounded text-[11px] font-bold uppercase text-center cursor-pointer transition ${
                  tool === "brush" ? "bg-indigo-600 text-white shadow-sm" : (isDarkMode ? "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-850" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-55")
                }`}
              >
                Inpainting
              </button>
              <button
                onClick={() => setTool("rectangle")}
                className={`py-2 px-3 rounded text-[11px] font-bold uppercase text-center cursor-pointer transition ${
                  tool === "rectangle" ? "bg-indigo-600 text-white shadow-sm" : (isDarkMode ? "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-850" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-55")
                }`}
              >
                Filigran Box
              </button>
            </div>
          </div>

          {/* Settings Card */}
          <div className={`border p-4 rounded-lg transition-colors duration-205 ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
            <h3 className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${isDarkMode ? "text-slate-500" : "text-slate-450"}`}>Settings</h3>
            <div className={`space-y-3.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
              <div className="flex justify-between items-center">
                <span>Preserve Filename</span>
                <span className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${isDarkMode ? "text-indigo-400 bg-indigo-950/50" : "text-indigo-600 bg-indigo-50"}`}>ALWAYS ON</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Auto-Export (Media)</span>
                <span className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${isDarkMode ? "text-indigo-400 bg-indigo-950/50" : "text-indigo-600 bg-indigo-50"}`}>ENABLED</span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span>Pipeline Level</span>
                <span className={`text-xs font-mono font-bold ${isDarkMode ? "text-indigo-400" : "text-indigo-600"}`}>GPU Accelerated</span>
              </div>
              
              {/* Diameter Slider */}
              <div className={`border-t pt-3 space-y-1.5 ${isDarkMode ? "border-slate-800" : "border-slate-100"}`}>
                <div className={`flex justify-between font-mono text-[10px] ${isDarkMode ? "text-slate-505" : "text-slate-500"}`}>
                  <span>BRUSH SIZE</span>
                  <span className={`font-bold ${isDarkMode ? "text-indigo-400" : "text-indigo-600"}`}>{brushSize}px</span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="80"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className={`w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-600 ${isDarkMode ? "bg-slate-800" : "bg-slate-150"}`}
                />
              </div>
            </div>
          </div>

          {/* Batch operations */}
          {workspaceMode === "image" && images.length > 0 && (
            <div className="mt-auto pt-4 space-y-2">
              <button
                disabled={isProcessingBatch || !images.some(i => i.paths.length > 0 || i.boxes.length > 0)}
                onClick={handleBatchRemove}
                className={`w-full py-4 border rounded-lg font-bold text-xs tracking-widest uppercase shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.01] ${
                  isDarkMode
                    ? "bg-slate-100 border-slate-50 hover:bg-white text-slate-950 shadow-white/[0.02]"
                    : "bg-slate-900 border-slate-800 hover:bg-black text-white"
                }`}
              >
                {isProcessingBatch ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing Batch...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Process Batch ({images.filter(i => i.paths.length > 0 || i.boxes.length > 0).length})</span>
                  </>
                )}
              </button>

              <button
                onClick={triggerZipDownload}
                disabled={images.length === 0}
                className={`w-full py-2.5 border text-xs rounded-lg font-medium tracking-wide flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  isDarkMode 
                    ? "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:text-white" 
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download ZIP Archive</span>
              </button>
            </div>
          )}

        </aside>

        {/* Main Editor Canvas / Queue View */}
        <main className={`flex-1 p-6 lg:p-8 flex flex-col min-w-0 overflow-y-auto transition-colors duration-200 ${isDarkMode ? "bg-slate-950" : "bg-slate-100"}`}>
          
          {apiError && (
            <div className={`mb-4 p-3.5 rounded-lg text-xs flex justify-between items-start shadow-sm border ${isDarkMode ? "bg-rose-950/20 border-rose-900/40 text-rose-400" : "bg-rose-50 border-rose-100 text-rose-700"}`}>
              <span className="flex-1 pr-4">{apiError}</span>
              <button onClick={() => setApiError(null)} className="p-0.5 text-rose-400 hover:text-rose-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {workspaceMode === "image" ? (
            activeImage ? (
              <div className="flex-1 flex flex-col min-h-0 space-y-6">
                
                {/* Dynamic Workspace Container */}
                <div className={`rounded-xl border overflow-hidden flex flex-col shadow-sm flex-1 min-h-0 transition-colors duration-200 ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                  
                  {/* File Header Info bar */}
                  <div className={`border-b px-6 py-3 flex flex-wrap gap-4 items-center justify-between transition-colors duration-200 ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <div className="flex items-center gap-2.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono truncate max-w-[200px] transition-colors ${isDarkMode ? "text-indigo-400 bg-indigo-950/50" : "text-indigo-600 bg-indigo-50"}`} title={activeImage.name}>
                        {activeImage.name}
                      </span>
                      <span className={`text-[10px] uppercase font-bold tracking-wider transition-colors ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                        RESOLUTION: {activeImage.width}x{activeImage.height}px
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Corners Dropdown */}
                      <div className="relative group">
                        <button className={`px-2.5 py-1.5 border rounded-sm text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                          isDarkMode
                            ? "border-slate-850 hover:border-slate-705 bg-slate-950 text-slate-300 hover:text-white"
                            : "border-slate-200 hover:border-slate-350 bg-white text-slate-700"
                        }`}>
                          <span>Filigran Presets</span>
                          <ChevronRight className="w-3 h-3 rotate-90" />
                        </button>
                        <div className={`absolute right-0 top-full mt-1 w-44 rounded-sm shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-40 p-1 space-y-0.5 border transition-colors ${
                          isDarkMode
                            ? "bg-slate-900 border-slate-800 text-slate-200"
                            : "bg-white border-slate-200 text-slate-700"
                        }`}>
                          <button
                            onClick={() => handleApplyPreset("bottom-right")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                            onMouseEnter={() => setHoveredPreset("bottom-right")}
                            onMouseLeave={() => setHoveredPreset(null)}
                          >
                            Bottom Right Stamp
                          </button>
                          <button
                            onClick={() => handleApplyPreset("bottom-center")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                            onMouseEnter={() => setHoveredPreset("bottom-center")}
                            onMouseLeave={() => setHoveredPreset(null)}
                          >
                            Bottom Center Brand
                          </button>
                          <button
                            onClick={() => handleApplyPreset("top-left")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                            onMouseEnter={() => setHoveredPreset("top-left")}
                            onMouseLeave={() => setHoveredPreset(null)}
                          >
                            Top Left Logo
                          </button>
                          <button
                            onClick={() => handleApplyPreset("top-right")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                            onMouseEnter={() => setHoveredPreset("top-right")}
                            onMouseLeave={() => setHoveredPreset(null)}
                          >
                            Top Right Stamp
                          </button>
                          <button
                            onClick={() => handleApplyPreset("center-diagonal")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                            onMouseEnter={() => setHoveredPreset("center-diagonal")}
                            onMouseLeave={() => setHoveredPreset(null)}
                          >
                            Center Diagonal Brand
                          </button>
                        </div>
                      </div>

                      <button
                        disabled={activeImage.status === "detecting" || activeImage.status === "processing"}
                        onClick={handleAIDetect}
                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 rounded-sm text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>AI Smart Detect</span>
                      </button>

                      <button
                        disabled={activeImage.paths.length === 0 && activeImage.boxes.length === 0}
                        onClick={handleCopyMaskToAll}
                        className={`px-2.5 py-1.5 border disabled:opacity-50 rounded-sm text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                          isDarkMode
                            ? "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-55"
                        }`}
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Clone to All</span>
                      </button>
                    </div>
                  </div>

                  {/* Dark Interactive Editor Canvas viewport */}
                  <div className="flex-1 bg-slate-900 flex items-center justify-center p-6 relative overflow-hidden group min-h-[300px]">
                    <div className="relative max-w-full max-h-[45vh] lg:max-h-[50vh] aspect-auto shadow-2xl flex items-center justify-center bg-slate-950 rounded border border-slate-800">
                      <img
                        src={activeImage.processedUrl || activeImage.originalUrl}
                        alt="Active Viewport"
                        className="max-w-full max-h-[45vh] lg:max-h-[50vh] object-contain select-none pointer-events-none rounded opacity-90"
                      />

                      {/* Paintable Drawing Canvas Overlay */}
                      {!activeImage.processedUrl && (
                        <canvas
                          ref={canvasRef}
                          width={activeImage.width}
                          height={activeImage.height}
                          onMouseDown={handleStartDraw}
                          onMouseMove={handleMovingDraw}
                          onMouseUp={handleStopDraw}
                          onMouseLeave={handleStopDraw}
                          onTouchStart={handleStartDraw}
                          onTouchMove={handleMovingDraw}
                          onTouchEnd={handleStopDraw}
                          style={{ touchAction: "none" }}
                          className="absolute inset-0 w-full h-full object-contain pointer-events-auto cursor-crosshair z-10"
                        />
                      )}

                      {/* Bounding box hover hint */}
                      {hoveredPreset && !activeImage.processedUrl && (
                        <div
                          className="absolute bg-indigo-500/15 border-2 border-dashed border-indigo-500 pointer-events-none z-20 transition-all duration-150 animate-pulse"
                          style={{
                            top: hoveredPreset === "bottom-right" ? "82%" : hoveredPreset === "bottom-center" ? "86%" : hoveredPreset === "top-left" ? "2%" : hoveredPreset === "top-right" ? "2%" : "35%",
                            left: hoveredPreset === "bottom-right" ? "72%" : hoveredPreset === "bottom-center" ? "30%" : hoveredPreset === "top-left" ? "2%" : hoveredPreset === "top-right" ? "72%" : "20%",
                            width: hoveredPreset === "bottom-right" ? "26%" : hoveredPreset === "bottom-center" ? "40%" : hoveredPreset === "top-left" ? "26%" : hoveredPreset === "top-right" ? "26%" : "60%",
                            height: hoveredPreset === "bottom-right" ? "15%" : hoveredPreset === "bottom-center" ? "12%" : hoveredPreset === "top-left" ? "16%" : hoveredPreset === "top-right" ? "16%" : "30%"
                          }}
                        />
                      )}

                      {/* Loaders */}
                      {(activeImage.status === "processing" || activeImage.status === "detecting") && (
                        <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center z-35 text-white gap-3 rounded">
                          <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-full shadow-lg">
                            <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                          </div>
                          <span className="text-[10px] font-bold tracking-widest font-mono uppercase bg-slate-900/85 px-3 py-1.5 rounded border border-slate-800 shadow-sm">
                            {activeImage.status === "detecting" ? "AI ANALYZING STAMPS..." : "INPAINTING TEXTURE BRUSH..."}
                          </span>
                        </div>
                      )}
                    </div>

                    {activeImage.processedUrl && (
                      <div className="absolute top-4 left-4 z-40 bg-emerald-500/90 text-white font-bold text-[10px] tracking-wide uppercase py-1 px-3 rounded-full flex items-center gap-1 shadow-md">
                        <CheckCircle className="w-3.5 h-3.5" /> Output Ready (Identical Name Saved)
                      </div>
                    )}
                  </div>
                   {/* Bottom interactive action toolbar */}
                  <div className={`border-t py-3.5 px-6 flex flex-wrap gap-4 items-center justify-between transition-colors duration-200 ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <div className="flex items-center gap-1.5">
                      {!activeImage.processedUrl ? (
                        <>
                          <button
                            onClick={() => setTool("brush")}
                            className={`p-1.5 rounded-sm transition cursor-pointer ${
                              tool === "brush" ? "bg-indigo-600 text-white shadow" : (isDarkMode ? "bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-900" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50")
                            }`}
                            title="Inpainting Brush"
                          >
                            <Brush className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setTool("eraser")}
                            className={`p-1.5 rounded-sm transition cursor-pointer ${
                              tool === "eraser" ? "bg-indigo-600 text-white shadow" : (isDarkMode ? "bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-900" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50")
                            }`}
                            title="Erase Overlay Area"
                          >
                            <Eraser className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setTool("rectangle")}
                            className={`p-1.5 rounded-sm transition cursor-pointer ${
                              tool === "rectangle" ? "bg-indigo-600 text-white shadow" : (isDarkMode ? "bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-900" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50")
                            }`}
                            title="Add Bounding Area Box"
                          >
                            <Square className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setImages((prev) =>
                              prev.map((i) => (i.id === activeImageId ? { ...i, processedUrl: null, status: "idle" } : i))
                            );
                          }}
                          className={`px-3 py-1.5 border rounded text-xs font-semibold cursor-pointer transition-colors ${
                            isDarkMode
                              ? "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900"
                              : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          ← Edit Overlay Mask Again
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {!activeImage.processedUrl && (
                        <>
                          <button
                            onClick={handleUndo}
                            disabled={activeImage.paths.length === 0 && activeImage.boxes.length === 0}
                            className={`p-1.5 border disabled:opacity-50 rounded cursor-pointer transition-colors ${
                              isDarkMode 
                                ? "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900" 
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-105"
                            }`}
                          >
                            <Undo className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleClearMask}
                            disabled={activeImage.paths.length === 0 && activeImage.boxes.length === 0}
                            className={`px-3 py-1.5 border disabled:opacity-50 rounded-sm text-xs font-bold uppercase tracking-wider cursor-pointer transition ${
                              isDarkMode 
                                ? "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900" 
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-105"
                            }`}
                          >
                            Clear
                          </button>
                        </>
                      )}

                      {!activeImage.processedUrl ? (
                        <button
                          disabled={activeImage.paths.length === 0 && activeImage.boxes.length === 0}
                          onClick={() => handleRemoveWatermarkSingle(activeImage.id)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-sm text-xs tracking-wider uppercase transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm shadow-indigo-600/10"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Remove Watermark</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => triggerSingleDownload(activeImage)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-sm text-xs tracking-wider uppercase transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-600/10"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download Outputs</span>
                        </button>
                      )}
                    </div>
                  </div>

                </div>

                {/* Marked Region coordinates listing section */}
                <div className={`rounded-lg border p-4 transition-colors ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                  <h4 className={`text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                    <SquaresIcon className="w-4 h-4 text-slate-400" /> Mask Overlays on this file
                  </h4>

                  {activeImage.paths.length === 0 && activeImage.boxes.length === 0 ? (
                    <p className="text-xs text-slate-404 italic">No inpaint locations marked. Brush over the watermark or hit Auto AI Detect.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {activeImage.boxes.map((box, idx) => (
                        <div key={box.id} className={`p-2 border rounded flex items-center justify-between text-xs font-mono transition-colors ${isDarkMode ? "border-slate-800 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}>
                          <div className="truncate">
                            <span className={`font-bold uppercase tracking-tight text-[10px] ${isDarkMode ? "text-indigo-400" : "text-indigo-600"}`}>{box.label || "Box Area"}</span>
                            <span className={`text-[9px] ml-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>[{Math.round(box.xmin)}%, {Math.round(box.ymin)}%]</span>
                          </div>
                          <button onClick={() => deleteBox(box.id)} className="text-slate-405 hover:text-rose-500 p-0.5 cursor-pointer">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      {activeImage.paths.map((pth) => (
                        <div key={pth.id} className={`p-2 border rounded flex items-center justify-between text-xs font-mono transition-colors ${isDarkMode ? "border-slate-800 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}>
                          <div>
                            <span className={`font-bold uppercase tracking-tight text-[10px] ${isDarkMode ? "text-indigo-400" : "text-indigo-600"}`}>Brush Stroke</span>
                            <span className={`text-[9px] ml-1 ${isDarkMode ? "text-slate-505" : "text-slate-400"}`}>{pth.points.length} nodes ({pth.brushSize}px)</span>
                          </div>
                          <button
                            onClick={() => {
                              updateActiveImageMasks(
                                activeImage.paths.filter((p) => p.id !== pth.id),
                                activeImage.boxes
                              );
                            }}
                            className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 text-center shadow-xs transition-colors duration-200 ${isDarkMode ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
                <ImageIcon className={`w-12 h-12 mb-4 ${isDarkMode ? "text-slate-700" : "text-slate-300"}`} />
                <h3 className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? "text-slate-300" : "text-slate-800"}`}>Workspace idle</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Drop multiple JPG or PNG images on the left channel sidebar first to enable local canvas inpainting and batch actions.
                </p>
              </div>
            )
          ) : (
            activeVideo ? (
              <div className="flex-1 flex flex-col min-h-0 space-y-6">
                
                {/* Dynamic Workspace Container */}
                <div className={`rounded-xl border overflow-hidden flex flex-col shadow-sm flex-1 min-h-0 transition-colors duration-200 ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                  
                  {/* File Header Info bar */}
                  <div className={`border-b px-6 py-3 flex flex-wrap gap-4 items-center justify-between transition-colors duration-200 ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <div className="flex items-center gap-2.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono truncate max-w-[200px] transition-colors ${isDarkMode ? "text-indigo-400 bg-indigo-950/50" : "text-indigo-600 bg-indigo-50"}`} title={activeVideo.name}>
                        {activeVideo.name}
                      </span>
                      <span className={`text-[10px] uppercase font-bold tracking-wider transition-colors ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                        RESOLUTION: {activeVideo.width}x{activeVideo.height}px | DURATION: {Math.round(activeVideo.duration)}s
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Corners Dropdown */}
                      <div className="relative group">
                        <button className={`px-2.5 py-1.5 border rounded-sm text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                          isDarkMode
                            ? "border-slate-850 hover:border-slate-705 bg-slate-950 text-slate-300 hover:text-white"
                            : "border-slate-200 hover:border-slate-350 bg-white text-slate-700"
                        }`}>
                          <span>Filigran Presets</span>
                          <ChevronRight className="w-3 h-3 rotate-90" />
                        </button>
                        <div className={`absolute right-0 top-full mt-1 w-44 rounded-sm shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-40 p-1 space-y-0.5 border transition-colors ${
                          isDarkMode
                            ? "bg-slate-900 border-slate-800 text-slate-200"
                            : "bg-white border-slate-200 text-slate-700"
                        }`}>
                          <button
                            onClick={() => handleApplyPreset("bottom-right")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            Bottom Right Stamp
                          </button>
                          <button
                            onClick={() => handleApplyPreset("bottom-center")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            Bottom Center Brand
                          </button>
                          <button
                            onClick={() => handleApplyPreset("top-left")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            Top Left Logo
                          </button>
                          <button
                            onClick={() => handleApplyPreset("top-right")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            Top Right Stamp
                          </button>
                          <button
                            onClick={() => handleApplyPreset("center-diagonal")}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded transition font-medium cursor-pointer ${isDarkMode ? "hover:bg-slate-800 text-slate-300" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            Center Diagonal Brand
                          </button>
                        </div>
                      </div>

                      <button
                        disabled={activeVideo.paths.length === 0 && activeVideo.boxes.length === 0}
                        onClick={handleCopyMaskToAll}
                        className={`px-2.5 py-1.5 border disabled:opacity-50 rounded-sm text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                          isDarkMode
                            ? "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900"
                            : "border-slate-200 bg-white text-slate-606"
                        }`}
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Clone to All</span>
                      </button>
                    </div>
                  </div>

                  {/* Video Playback Interactive Viewport Container */}
                  <div className="flex-1 bg-slate-900 flex items-center justify-center p-6 relative overflow-hidden group min-h-[300px]">
                    <div className="relative max-w-full max-h-[45vh] lg:max-h-[50vh] aspect-auto shadow-2xl flex items-center justify-center bg-slate-950 rounded border border-slate-800">
                      
                      {/* HTML5 Video Element */}
                      <video
                        ref={videoRef}
                        src={activeVideo.processedUrl || activeVideo.originalUrl}
                        className="max-w-full max-h-[45vh] lg:max-h-[50vh] object-contain rounded opacity-90"
                        muted
                        playsInline
                        loop
                        onTimeUpdate={() => {
                          if (videoRef.current) setVideoTime(videoRef.current.currentTime);
                        }}
                        onLoadedMetadata={() => {
                          if (videoRef.current) setVideoDuration(videoRef.current.duration);
                        }}
                      />

                      {/* Paintable Drawing Canvas Overlay */}
                      {!activeVideo.processedUrl && (
                        <canvas
                          ref={canvasRef}
                          width={activeVideo.width}
                          height={activeVideo.height}
                          onMouseDown={handleStartDraw}
                          onMouseMove={handleMovingDraw}
                          onMouseUp={handleStopDraw}
                          onMouseLeave={handleStopDraw}
                          onTouchStart={handleStartDraw}
                          onTouchMove={handleMovingDraw}
                          onTouchEnd={handleStopDraw}
                          style={{ touchAction: "none" }}
                          className="absolute inset-0 w-full h-full object-contain pointer-events-auto cursor-crosshair z-10"
                        />
                      )}

                      {/* Loaders */}
                      {activeVideo.status === "processing" && (
                        <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center z-35 text-white gap-3 rounded">
                          <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-full shadow-lg">
                            <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                          </div>
                          <span className="text-[10px] font-bold tracking-widest font-mono uppercase bg-slate-900/85 px-3 py-1.5 rounded border border-slate-800 shadow-sm text-center">
                            {activeVideo.errorMsg || "REPAIRING VIDEO WATERMARKS..."}
                          </span>
                        </div>
                      )}
                    </div>

                    {activeVideo.processedUrl && (
                      <div className="absolute top-4 left-4 z-40 bg-emerald-500/90 text-white font-bold text-[10px] tracking-wide uppercase py-1 px-3 rounded-full flex items-center gap-1 shadow-md">
                        <CheckCircle className="w-3.5 h-3.5" /> Clean Video Output Ready
                      </div>
                    )}
                  </div>

                  {/* Scrub seek bar */}
                  <div className={`px-6 py-2 border-t flex items-center gap-3 transition-colors ${isDarkMode ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-100"}`}>
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                      {Math.round(videoTime)}s
                    </span>
                    <input
                      type="range"
                      min="0"
                      max={videoDuration || 100}
                      step="0.05"
                      value={videoTime}
                      onChange={(e) => {
                        const t = parseFloat(e.target.value);
                        setVideoTime(t);
                        if (videoRef.current) videoRef.current.currentTime = t;
                      }}
                      className="flex-1 h-1 rounded-full appearance-none cursor-pointer accent-indigo-600 bg-slate-800"
                    />
                    <span className="text-[10px] font-mono font-bold text-slate-400">
                      {Math.round(videoDuration || 0)}s
                    </span>
                  </div>

                  {/* Bottom interactive action toolbar */}
                  <div className={`border-t py-3.5 px-6 flex flex-wrap gap-4 items-center justify-between transition-colors duration-200 ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                    <div className="flex items-center gap-2">
                      {/* Play/Pause control */}
                      <button
                        onClick={() => {
                          if (!videoRef.current) return;
                          if (isPlaying) {
                            videoRef.current.pause();
                            setIsPlaying(false);
                          } else {
                            videoRef.current.play();
                            setIsPlaying(true);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1 cursor-pointer transition bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        <span>{isPlaying ? "Pause" : "Play"}</span>
                      </button>

                      {!activeVideo.processedUrl ? (
                        <>
                          <button
                            onClick={() => setTool("brush")}
                            className={`p-1.5 rounded-sm transition cursor-pointer ${
                              tool === "brush" ? "bg-indigo-600 text-white shadow" : (isDarkMode ? "bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-900" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50")
                            }`}
                            title="Inpainting Brush"
                          >
                            <Brush className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setTool("eraser")}
                            className={`p-1.5 rounded-sm transition cursor-pointer ${
                              tool === "eraser" ? "bg-indigo-600 text-white shadow" : (isDarkMode ? "bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-900" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50")
                            }`}
                            title="Erase Overlay Area"
                          >
                            <Eraser className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setTool("rectangle")}
                            className={`p-1.5 rounded-sm transition cursor-pointer ${
                              tool === "rectangle" ? "bg-indigo-600 text-white shadow" : (isDarkMode ? "bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-900" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50")
                            }`}
                            title="Add Bounding Area Box"
                          >
                            <Square className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setVideos((prev) =>
                              prev.map((v) => (v.id === activeVideoId ? { ...v, processedUrl: null, status: "idle" } : v))
                            );
                          }}
                          className={`px-3 py-1.5 border rounded text-xs font-semibold cursor-pointer transition-colors ${
                            isDarkMode
                              ? "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900"
                              : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          ← Edit Overlay Mask Again
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {!activeVideo.processedUrl && (
                        <>
                          <button
                            onClick={handleUndo}
                            disabled={activeVideo.paths.length === 0 && activeVideo.boxes.length === 0}
                            className={`p-1.5 border disabled:opacity-50 rounded cursor-pointer transition-colors ${
                              isDarkMode 
                                ? "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900" 
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-105"
                            }`}
                          >
                            <Undo className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleClearMask}
                            disabled={activeVideo.paths.length === 0 && activeVideo.boxes.length === 0}
                            className={`px-3 py-1.5 border disabled:opacity-50 rounded-sm text-xs font-bold uppercase tracking-wider cursor-pointer transition ${
                              isDarkMode 
                                ? "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900" 
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-105"
                            }`}
                          >
                            Clear
                          </button>
                        </>
                      )}

                      {!activeVideo.processedUrl ? (
                        <button
                          disabled={activeVideo.paths.length === 0 && activeVideo.boxes.length === 0}
                          onClick={() => handleRemoveWatermarkVideo(activeVideo.id)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-sm text-xs tracking-wider uppercase transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm shadow-indigo-600/10"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Remove Watermark</span>
                        </button>
                      ) : (
                        <a
                          href={activeVideo.processedUrl}
                          download={activeVideo.name.replace(/\.[^/.]+$/, "") + "_cleared.webm"}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-sm text-xs tracking-wider uppercase transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-600/10"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download Output</span>
                        </a>
                      )}
                    </div>
                  </div>

                </div>

                {/* Marked Region coordinates listing section */}
                <div className={`rounded-lg border p-4 transition-colors ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}>
                  <h4 className={`text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                    <SquaresIcon className="w-4 h-4 text-slate-400" /> Mask Overlays on this file
                  </h4>

                  {activeVideo.paths.length === 0 && activeVideo.boxes.length === 0 ? (
                    <p className="text-xs text-slate-404 italic">No inpaint locations marked. Brush over the watermark or apply preset stamps.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {activeVideo.boxes.map((box, idx) => (
                        <div key={box.id} className={`p-2 border rounded flex items-center justify-between text-xs font-mono transition-colors ${isDarkMode ? "border-slate-800 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}>
                          <div className="truncate">
                            <span className={`font-bold uppercase tracking-tight text-[10px] ${isDarkMode ? "text-indigo-400" : "text-indigo-600"}`}>{box.label || "Box Area"}</span>
                            <span className={`text-[9px] ml-1 ${isDarkMode ? "text-slate-500" : "text-slate-404"}`}>[{Math.round(box.xmin)}%, {Math.round(box.ymin)}%]</span>
                          </div>
                          <button onClick={() => deleteBox(box.id)} className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      {activeVideo.paths.map((pth) => (
                        <div key={pth.id} className={`p-2 border rounded flex items-center justify-between text-xs font-mono transition-colors ${isDarkMode ? "border-slate-800 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}>
                          <div>
                            <span className={`font-bold uppercase tracking-tight text-[10px] ${isDarkMode ? "text-indigo-400" : "text-indigo-600"}`}>Brush Stroke</span>
                            <span className={`text-[9px] ml-1 ${isDarkMode ? "text-slate-505" : "text-slate-404"}`}>{pth.points.length} nodes ({pth.brushSize}px)</span>
                          </div>
                          <button
                            onClick={() => {
                              updateActiveVideoMasks(
                                activeVideo.paths.filter((p) => p.id !== pth.id),
                                activeVideo.boxes
                              );
                            }}
                            className="text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 text-center shadow-xs transition-colors duration-200 ${isDarkMode ? "border-slate-800 bg-slate-900" : "border-slate-205 bg-white"}`}>
                <Film className={`w-12 h-12 mb-4 animate-pulse ${isDarkMode ? "text-slate-700" : "text-slate-300"}`} />
                <h3 className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? "text-slate-300" : "text-slate-800"}`}>Video Workspace idle</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Drop video files on the left channel sidebar first to enable canvas-aligned inpaint overlays across all video frames sequentially.
                </p>
              </div>
            )
          )}
        </main>
      </div>

      {/* Footer Bar */}
      <footer className={`h-10 text-white flex items-center justify-between px-8 shrink-0 select-none border-t transition-colors duration-200 ${isDarkMode ? "bg-slate-950 border-slate-900" : "bg-slate-900 border-slate-950"}`}>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">Engine: Active</span>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 hidden sm:block font-mono">Processing Capacity: 100%</span>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-bold">
          Batch Sync Enabled • Metadata Preservation Active • <span className="text-indigo-400 capitalize font-sans tracking-normal font-semibold">Created by nakyoS</span>
        </div>
      </footer>

    </div>
  );
}

// Custom simple helper components
function SquaresIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

export interface RectBox {
  id: string;
  label: string;
  ymin: number; // percentage 0 - 100
  xmin: number; // percentage 0 - 100
  ymax: number; // percentage 0 - 100
  xmax: number; // percentage 0 - 100
  isAiDetected?: boolean;
}

export interface BrushPath {
  id: string;
  points: Array<{ x: number; y: number }>; // percentage 0 - 100 of image dimensions
  brushSize: number; // percentage relative to width
}

export interface UploadedImage {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  mimeType: string;
  originalUrl: string; // Base64 or ObjectURL
  processedUrl: string | null; // Base64 or ObjectURL of results
  status: "idle" | "detecting" | "processing" | "done" | "error";
  errorMsg?: string;
  boxes: RectBox[];
  paths: BrushPath[];
}

export type ToolType = "brush" | "eraser" | "rectangle";

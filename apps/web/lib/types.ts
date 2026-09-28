export type UploadStatus =
  | "pending"
  | "uploading"
  | "processing"
  | "success"
  | "error";

export interface UploadedVideo {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  createdAt: number;
  videoId?: string;
  jobId?: string;
}

export interface UploadSessionResponse {
  videoId: string;
  storageKey: string;
  uploadUrl: string;
  uploadMethod: "PUT" | "POST";
  uploadExpiresInSec: number;
}

export interface ProcessResponse {
  jobId: string;
}

export interface SseProgressEvent {
  jobId: string;
  stage?: string;
  progress?: number;
  status?: string;
}

export interface SseFailedEvent {
  jobId: string;
  error?: string;
}

export type VideoStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "CALIBRATED"
  | "PROCESSING"
  | "PROCESSED"
  | "FAILED";

export type JobStatus =
  | "UPLOADED"
  | "PREPARING"
  | "DETECTING"
  | "VERIFYING"
  | "GENERATING_CLIPS"
  | "READY"
  | "EXPORTING"
  | "EXPORTED"
  | "FAILED";

export type HighlightType = "MADE_BASKET" | "ASSIST" | "STEAL" | "BLOCK" | "OTHER";

export type HighlightUserStatus = "PENDING" | "SELECTED" | "DELETED";

export interface Video {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  status: VideoStatus;
  storageKey: string;
  sourceBucket: string;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  sizeBytes?: number;
  calibration?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  downloadUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingJob {
  id: string;
  videoId: string;
  projectId: string;
  userId: string;
  status: JobStatus;
  stage?: string;
  progress: number;
  errorMessage?: string;
  pipeline?: string;
  model?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Highlight {
  id: string;
  videoId: string;
  processingJobId: string;
  userId: string;
  startTimeSec: number;
  endTimeSec: number;
  eventTimeSec: number;
  confidence: number;
  type: HighlightType;
  thumbnailStorageKey?: string;
  clipStorageKey?: string;
  metadata?: Record<string, unknown>;
  userStatus: HighlightUserStatus;
  deleted: boolean;
  userEditedStart?: number;
  userEditedEnd?: number;
  userNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExportType = "INDIVIDUAL" | "MERGE";

export type ExportStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export interface Export {
  id: string;
  userId: string;
  projectId: string;
  type: ExportType;
  highlightIds: string[];
  status: ExportStatus;
  storageKey?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
  sizeBytes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  role: "USER" | "ADMIN";
  createdAt: string;
}

/**
 * Configuration constants shared across API modules.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;
export const READ_TIMEOUT_MS = 45_000;
export const WRITE_TIMEOUT_MS = 60_000;
export const EXPORT_TIMEOUT_MS = 120_000;

export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_TEXT_LENGTH = 10 * 1024 * 1024; // 10MB
export const MAX_PROCESSING_TIME_MS = 60_000;
export const CHUNK_SIZE = 1000;

export const DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

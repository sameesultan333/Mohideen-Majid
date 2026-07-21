// src/api/upload.ts

import api from "./axios";

/* ============================================================================
 * Types
 * ========================================================================== */

export interface UploadResponse {
  url: string;

  filename: string;

  content_type?: string;

  size?: number;
}

/* ============================================================================
 * Upload Single File
 * ========================================================================== */

export const uploadFile = async (
  uri: string,
  fileName: string,
  mimeType: string
): Promise<UploadResponse> => {
  const formData = new FormData();

  formData.append("file", {
    uri,
    name: fileName,
    type: mimeType,
  } as any);

  const { data } = await api.post("/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return data;
};

/* ============================================================================
 * Upload Receipt
 * ========================================================================== */

export const uploadReceipt = async (
  uri: string,
  fileName: string,
  mimeType: string
): Promise<UploadResponse> => {
  const formData = new FormData();

  formData.append("file", {
    uri,
    name: fileName,
    type: mimeType,
  } as any);

  const { data } = await api.post("/upload/receipt", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return data;
};

/* ============================================================================
 * Delete Uploaded File
 * ========================================================================== */

export const deleteUploadedFile = async (
  fileUrl: string
): Promise<{ message: string }> => {
  const { data } = await api.delete("/upload", {
    data: {
      file_url: fileUrl,
    },
  });

  return data;
};
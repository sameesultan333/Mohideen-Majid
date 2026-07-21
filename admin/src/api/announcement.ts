// src/api/announcement.ts

import api from "./axios";

import type {
  Announcement,
  CreateAnnouncementPayload,
  UpdateAnnouncementPayload,
} from "../types/announcement";

/* ============================================================================
 * Get All Announcements
 * ========================================================================= */

export const getAnnouncements = async (): Promise<Announcement[]> => {
  const { data } = await api.get("/announcements/?all=true");
  return data;
};

/* ============================================================================
 * Get Single Announcement (Future Ready)
 * ========================================================================= */

export const getAnnouncement = async (
  announcementId: number
): Promise<Announcement> => {
  const { data } = await api.get(`/announcements/${announcementId}`);
  return data;
};

/* ============================================================================
 * Create Announcement
 * ========================================================================= */

export const createAnnouncement = async (
  payload: CreateAnnouncementPayload
): Promise<Announcement> => {
  const { data } = await api.post("/announcements/", payload);
  return data;
};

/* ============================================================================
 * Update Announcement (Future Ready)
 * ========================================================================= */

export const updateAnnouncement = async (
  announcementId: number,
  payload: UpdateAnnouncementPayload
): Promise<Announcement> => {
  const { data } = await api.put(
    `/announcements/${announcementId}`,
    payload
  );

  return data;
};

/* ============================================================================
 * Delete Announcement
 * ========================================================================= */

export const deleteAnnouncement = async (
  announcementId: number
): Promise<{ message: string }> => {
  const { data } = await api.delete(
    `/announcements/${announcementId}`
  );

  return data;
};
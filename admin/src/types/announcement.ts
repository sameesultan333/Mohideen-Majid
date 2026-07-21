// src/types/announcement.ts

/* ============================================================================
 * Announcement
 * ========================================================================== */

export interface Announcement {
  id: number;

  title: string;

  body: string;

  pinned: boolean;

  posted_by: string;

  created_at: string;

  image_url?: string | null;

  audio_url?: string | null;

  is_active?: boolean;

  expires_at?: string | null;

  target_user_id?: number | null;
}

/* ============================================================================
 * Create Announcement
 * ========================================================================== */

export interface CreateAnnouncementPayload {
  title: string;

  body: string;

  pinned?: boolean;

  image_url?: string;

  audio_url?: string;

  target_user_id?: number | null;
}

/* ============================================================================
 * Update Announcement
 * ========================================================================== */

export interface UpdateAnnouncementPayload {
  title?: string;

  body?: string;

  pinned?: boolean;

  image_url?: string | null;

  audio_url?: string | null;
}

/* ============================================================================
 * Announcement Filters (Future Ready)
 * ========================================================================== */

export interface AnnouncementFilters {
  pinned?: boolean;

  active_only?: boolean;

  search?: string;
}
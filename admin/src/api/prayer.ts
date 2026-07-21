// src/api/prayer.ts

import api from "./axios";

export interface PrayerTimings {
  configured?: boolean;
  version?: number;
  early: {
    imsak: string | null;
    sunrise: string | null;
    dhuha: string | null;
  };

  adhan: {
    fajr: string;
    dhuhr: string;
    asr: string;
    maghrib: string;
    isha: string;
  };

  prayer: {
    fajr: string;
    dhuhr: string;
    asr: string;
    maghrib: string;
    isha: string;
    jummah: string;
    jummah_iqamah: string;
  };

  special: {
    ishraq: string;
    taraweeh: string;
    sunset: string;
  };

  notes?: string | null;

  updated_by?: string | null;
  updated_at?: string | null;
}

export interface PrayerUpdatePayload {
  // Early
  imsak: string;
  sunrise: string;
  dhuha: string;

  // Adhan
  fajr_adhan: string;
  dhuhr_adhan: string;
  asr_adhan: string;
  maghrib_adhan: string;
  isha_adhan: string;

  // Prayer / Iqamah
  fajr: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  jummah: string;
  jummah_iqamah: string;

  // Special
  taraweeh: string;
  ishraq: string;
  sunset: string;

  notes?: string;
}

export interface CurrentPrayerResponse {
  current_prayer: string;
  next_prayer: string;
  remaining: string;
}

class PrayerService {
  /**
   * Get all prayer timings
   */
  async getPrayerTimes(): Promise<PrayerTimings> {
    const { data } = await api.get<PrayerTimings>("/prayer/");
    return data;
  }

  /**
   * Update prayer timings
   */
  async updatePrayerTimes(
    payload: PrayerUpdatePayload,
  ) {
    const { data } = await api.put("/prayer/", payload);
    return data;
  }

  /**
   * Current / Next Prayer
   */
  async getCurrentPrayer(): Promise<CurrentPrayerResponse> {
    const { data } = await api.get<CurrentPrayerResponse>(
      "/prayer/current",
    );
    return data;
  }
}

export const prayerService = new PrayerService();
export default prayerService;
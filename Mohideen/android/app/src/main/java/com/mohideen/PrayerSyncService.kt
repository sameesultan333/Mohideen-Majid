package com.mohideen

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class PrayerSyncService : ForegroundHeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent) = HeadlessJsTaskConfig(
        "PrayerSyncTask", Arguments.createMap(), 30000, true
    )
}

package com.mohideen

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class PrayerRescheduleService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent): HeadlessJsTaskConfig {
        return HeadlessJsTaskConfig(
            "PrayerNotificationReschedule",
            Arguments.createMap(),
            5000,   // timeout ms
            true    // allowed in foreground
        )
    }
}

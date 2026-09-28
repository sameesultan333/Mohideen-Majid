package com.mohideen

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat

class PrayerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val eventId = intent.getStringExtra(IqamahSchedulerModule.EXTRA_EVENT_ID) ?: return
        if (!IqamahSchedulerModule.claimEvent(context, eventId)) return

        val serviceIntent = Intent(context, PrayerAudioService::class.java).apply {
            putExtra(PrayerAudioService.EXTRA_TYPE, intent.getStringExtra(IqamahSchedulerModule.EXTRA_TYPE))
            putExtra(IqamahSchedulerModule.EXTRA_EVENT_ID, eventId)
            putExtra(PrayerAudioService.EXTRA_PRAYER_NAME, intent.getStringExtra("prayer_name") ?: "Prayer")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(context, serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}

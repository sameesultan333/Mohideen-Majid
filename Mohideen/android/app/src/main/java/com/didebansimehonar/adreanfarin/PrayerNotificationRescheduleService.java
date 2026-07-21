package com.didebansimehonar.adreanfarin;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;

/**
 * PrayerNotificationRescheduleService
 * 
 * This headless JS service runs after device boot to reschedule prayer notifications.
 * It triggers a JavaScript task that reads prayer times from local storage
 * and reschedules all notifications.
 */
public class PrayerNotificationRescheduleService extends HeadlessJsTaskService {
    private static final String TAG = "PrayerNotificationReschedule";
    private static final String TASK_NAME = "PrayerNotificationReschedule";

    @Override
    protected HeadlessJsTaskConfig getTaskConfig(Intent intent) {
        Bundle extras = intent.getExtras();
        WritableMap data = Arguments.createMap();
        
        if (extras != null) {
            data.putString("action", "reschedule_notifications");
        }
        
        return new HeadlessJsTaskConfig(
            TASK_NAME,
            data,
            5000, // timeout in ms
            true // allowedInForeground
        );
    }
}

package com.mohideen

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/** Owns prayer audio independently of React Native and notification playback. */
class PrayerAudioService : Service() {
    private var player: MediaPlayer? = null
    private var audioManager: AudioManager? = null
    private var focusRequest: AudioFocusRequest? = null
    private var pausedForTransientFocus = false
    private var prayerName = "Prayer"
    private var prayerType = PrayerAudioService.TYPE_ADHAN
    private val volumeHandler = Handler(Looper.getMainLooper())
    private val volumeStreams = intArrayOf(
        AudioManager.STREAM_ALARM,
        AudioManager.STREAM_MUSIC,
        AudioManager.STREAM_RING,
        AudioManager.STREAM_NOTIFICATION,
        AudioManager.STREAM_SYSTEM,
    )
    private val initialVolumes = IntArray(volumeStreams.size)
    private val volumePoller = object : Runnable {
        override fun run() {
            val manager = audioManager ?: return
            if (volumeStreams.indices.any { manager.getStreamVolume(volumeStreams[it]) != initialVolumes[it] }) {
                finishPlayback()
                return
            }
            volumeHandler.postDelayed(this, 250L)
        }
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_SCREEN_OFF) {
                Log.i(TAG, "Screen off received; stopping prayer audio")
                finishPlayback()
            }
        }
    }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                player?.let {
                    it.setVolume(1f, 1f)
                    if (pausedForTransientFocus) {
                        pausedForTransientFocus = false
                        it.start()
                    }
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                player?.let {
                    if (it.isPlaying) {
                        it.pause()
                        pausedForTransientFocus = true
                    }
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // Prayer audio uses the alarm stream. Keep full volume so an
                // ordinary notification cannot permanently duck the Adhan.
                player?.setVolume(1f, 1f)
            }
            AudioManager.AUDIOFOCUS_LOSS -> finishPlayback()
        }
    }

    override fun onCreate() {
        super.onCreate()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        volumeStreams.forEachIndexed { index, stream ->
            initialVolumes[index] = audioManager?.getStreamVolume(stream) ?: 0
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // SCREEN_OFF is a protected system broadcast. Marking this
            // receiver exported is required for Android 13+ to deliver it.
            registerReceiver(screenReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF), RECEIVER_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(screenReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopPlayback()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        prayerName = intent?.getStringExtra(EXTRA_PRAYER_NAME) ?: "Prayer"
        prayerType = intent?.getStringExtra(EXTRA_TYPE) ?: TYPE_ADHAN
        Log.i(TAG, "Starting $prayerType playback for $prayerName")
        startForeground(NOTIFICATION_ID, buildNotification())
        val type = intent?.getStringExtra(EXTRA_TYPE) ?: TYPE_ADHAN
        startPlayback(type)
        volumeHandler.removeCallbacks(volumePoller)
        volumeHandler.postDelayed(volumePoller, 250L)
        return START_NOT_STICKY
    }

    private fun startPlayback(type: String) {
        stopPlayback()
        if (!requestAudioFocus()) {
            Log.w(TAG, "Unable to acquire audio focus for $type")
            stopSelf()
            return
        }

        val resource = if (type == TYPE_IQAMAH) R.raw.start_prayer else R.raw.adhan
        val resourceUri = Uri.parse("android.resource://$packageName/$resource")
        val nextPlayer = MediaPlayer()
        try {
            // Configure the player before prepare(); changing audio attributes
            // after MediaPlayer.create() leaves the player idle on some Samsung
            // builds and produces a silent foreground service.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                nextPlayer.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
            }
            nextPlayer.setWakeMode(this@PrayerAudioService, android.os.PowerManager.PARTIAL_WAKE_LOCK)
            nextPlayer.setOnCompletionListener { finishPlayback() }
            nextPlayer.setOnErrorListener { _, what, extra ->
                Log.e(TAG, "MediaPlayer error what=$what extra=$extra")
                finishPlayback()
                true
            }
            nextPlayer.setDataSource(this, resourceUri)
            nextPlayer.prepare()
            player = nextPlayer
            nextPlayer.start()
            Log.i(TAG, "Playback started resource=$resource uri=$resourceUri")
        } catch (error: Exception) {
            Log.e(TAG, "Unable to start resource=$resource uri=$resourceUri", error)
            nextPlayer.release()
            releaseAudioFocus()
            stopSelf()
        }
    }

    private fun requestAudioFocus(): Boolean {
        val manager = audioManager ?: return false
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                .setAcceptsDelayedFocusGain(false)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = request
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_ALARM,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            )
        }
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun stopPlayback() {
        player?.let {
            it.setOnCompletionListener(null)
            it.setOnErrorListener(null)
            if (it.isPlaying) it.stop()
            it.reset()
            it.release()
        }
        player = null
        pausedForTransientFocus = false
        releaseAudioFocus()
    }

    private fun finishPlayback() {
        stopPlayback()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun releaseAudioFocus() {
        val manager = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { manager.abandonAudioFocusRequest(it) }
            focusRequest = null
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(focusListener)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, IqamahSchedulerModule.PRAYER_AUDIO_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("$prayerName ${if (prayerType == TYPE_IQAMAH) "Iqamah" else "Adhan"}")
            .setContentText(if (prayerType == TYPE_IQAMAH) {
                "Iqamah is starting - join the congregation."
            } else {
                "The Adhan for $prayerName has begun."
            })
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    override fun onDestroy() {
        volumeHandler.removeCallbacks(volumePoller)
        unregisterReceiver(screenReceiver)
        stopPlayback()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_STOP = "com.mohideen.action.STOP_PRAYER_AUDIO"
        const val EXTRA_TYPE = "audio_type"
        const val EXTRA_PRAYER_NAME = "prayer_name"
        const val TYPE_ADHAN = "adhan"
        const val TYPE_IQAMAH = "iqamah"
        private const val TAG = "PrayerAudioService"
        private const val NOTIFICATION_ID = 9910
    }
}

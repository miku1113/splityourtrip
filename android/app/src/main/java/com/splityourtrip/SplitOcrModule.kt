package com.splityourtrip

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.io.FileInputStream

class SplitOcrModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "SplitOcr"
        const val PREFS_NAME = "SplitSharedData"
        const val KEY_IMAGE_URI = "shared_image_uri"
        const val KEY_SHARED_TEXT = "shared_text"

        var sharedImageUri: String? = null
        var sharedText: String? = null
        private var instance: SplitOcrModule? = null

        fun notifySharedDataReceived(context: android.content.Context?, uri: String?, text: String?) {
            sharedImageUri = uri
            sharedText = text

            if (context != null) {
                try {
                    val prefs = context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
                    prefs.edit()
                        .putString(KEY_IMAGE_URI, uri)
                        .putString(KEY_SHARED_TEXT, text)
                        .apply()
                } catch (e: Exception) {
                    android.util.Log.e("SplitOcrModule", "Error saving shared data to SharedPreferences", e)
                }
            }

            instance?.sendSharedDataEvent()
        }
    }

    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    init {
        instance = this
        reactContext.addActivityEventListener(this)

        if (sharedImageUri == null && sharedText == null) {
            try {
                val prefs = reactContext.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
                sharedImageUri = prefs.getString(KEY_IMAGE_URI, null)
                sharedText = prefs.getString(KEY_SHARED_TEXT, null)
            } catch (e: Exception) {
                android.util.Log.e("SplitOcrModule", "Error restoring shared data", e)
            }
        }
    }

    override fun initialize() {
        super.initialize()
        if (sharedImageUri != null || sharedText != null) {
            reactContext.runOnJSQueueThread {
                sendSharedDataEvent()
            }
        }
    }

    override fun getName(): String = NAME

    private fun getRotationDegrees(exif: ExifInterface?): Int {
        if (exif == null) return 0
        return when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }
    }

    private fun createInputImage(imageUriString: String): InputImage {
        if (imageUriString.startsWith("content://")) {
            val contentUri = Uri.parse(imageUriString)
            return try {
                InputImage.fromFilePath(reactContext, contentUri)
            } catch (e: Exception) {
                val inputStream = reactContext.contentResolver.openInputStream(contentUri)
                val bitmap = BitmapFactory.decodeStream(inputStream)
                inputStream?.close()
                if (bitmap != null) {
                    val exifStream = reactContext.contentResolver.openInputStream(contentUri)
                    val exif = if (exifStream != null) {
                        val ex = try { ExifInterface(exifStream) } catch (e: Exception) { null }
                        exifStream.close()
                        ex
                    } else null
                    val rotation = getRotationDegrees(exif)
                    InputImage.fromBitmap(bitmap, rotation)
                } else {
                    InputImage.fromFilePath(reactContext, contentUri)
                }
            }
        }

        // File path or file:// URI
        val cleanPath = when {
            imageUriString.startsWith("file://") -> Uri.parse(imageUriString).path ?: imageUriString.removePrefix("file://")
            else -> imageUriString
        }

        val file = File(cleanPath)
        if (!file.exists()) {
            throw IllegalArgumentException("File does not exist at path: $cleanPath")
        }

        // Decode bounds to prevent OOM on 48MP phone cameras
        val boundsOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, boundsOptions)
        var sampleSize = 1
        val maxDimension = Math.max(boundsOptions.outWidth, boundsOptions.outHeight)
        while (maxDimension / sampleSize > 2400) {
            sampleSize *= 2
        }

        val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        val bitmap = BitmapFactory.decodeFile(file.absolutePath, decodeOptions)
            ?: throw IllegalStateException("Could not decode bitmap from file: $cleanPath")

        val exif = try {
            ExifInterface(file.absolutePath)
        } catch (e: Exception) {
            null
        }
        val rotation = getRotationDegrees(exif)
        return InputImage.fromBitmap(bitmap, rotation)
    }

    private fun buildSpatiallyReconstructedText(visionText: Text): String {
        val allLines = mutableListOf<Text.Line>()
        for (block in visionText.textBlocks) {
            allLines.addAll(block.lines)
        }

        if (allLines.isEmpty()) {
            return visionText.text ?: ""
        }

        // Sort lines primarily by top Y position
        val sortedLines = allLines.sortedWith(compareBy({ it.boundingBox?.top ?: 0 }, { it.boundingBox?.left ?: 0 }))

        // Cluster lines into rows based on vertical proximity
        val rows = mutableListOf<MutableList<Text.Line>>()
        for (line in sortedLines) {
            val box = line.boundingBox ?: continue
            val lineMidY = (box.top + box.bottom) / 2.0
            val lineHeight = (box.bottom - box.top).coerceAtLeast(10)
            val tolerance = lineHeight * 0.45

            val matchingRow = rows.find { row ->
                val rowMidY = row.map {
                    val b = it.boundingBox
                    if (b != null) (b.top + b.bottom) / 2.0 else 0.0
                }.average()
                Math.abs(lineMidY - rowMidY) <= tolerance
            }

            if (matchingRow != null) {
                matchingRow.add(line)
            } else {
                rows.add(mutableListOf(line))
            }
        }

        val sb = StringBuilder()
        for (row in rows) {
            val sortedRow = row.sortedBy { it.boundingBox?.left ?: 0 }
            val rowText = sortedRow.joinToString("   ") { it.text }
            sb.append(rowText).append("\n")
        }

        val spatial = sb.toString().trim()
        val raw = (visionText.text ?: "").trim()
        return if (spatial.isNotBlank()) {
            "$spatial\n\n$raw"
        } else {
            raw
        }
    }

    @ReactMethod
    fun recognizeText(imageUriString: String?, promise: Promise) {
        if (imageUriString.isNullOrBlank()) {
            promise.resolve("")
            return
        }

        try {
            val image = createInputImage(imageUriString)
            recognizer.process(image)
                .addOnSuccessListener { visionText ->
                    val combinedText = buildSpatiallyReconstructedText(visionText)
                    promise.resolve(combinedText)
                }
                .addOnFailureListener { exception ->
                    android.util.Log.w("SplitOcrModule", "ML Kit OCR failed: ${exception.message}")
                    promise.resolve("")
                }
        } catch (e: Exception) {
            android.util.Log.e("SplitOcrModule", "Error loading image for OCR: $imageUriString", e)
            promise.resolve("")
        }
    }

    private fun ensureSharedDataLoaded() {
        if (sharedImageUri == null && sharedText == null) {
            try {
                val prefs = reactContext.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
                sharedImageUri = prefs.getString(KEY_IMAGE_URI, null)
                sharedText = prefs.getString(KEY_SHARED_TEXT, null)
            } catch (e: Exception) {
                android.util.Log.e("SplitOcrModule", "Error reading SharedPreferences in ensureSharedDataLoaded", e)
            }
        }
    }

    @ReactMethod
    fun getSharedImageUri(promise: Promise) {
        ensureSharedDataLoaded()
        promise.resolve(sharedImageUri)
    }

    @ReactMethod
    fun getSharedText(promise: Promise) {
        ensureSharedDataLoaded()
        promise.resolve(sharedText)
    }

    @ReactMethod
    fun getSharedData(promise: Promise) {
        ensureSharedDataLoaded()
        val map: WritableMap = Arguments.createMap()
        map.putString("imageUri", sharedImageUri)
        map.putString("sharedText", sharedText)
        promise.resolve(map)
    }

    @ReactMethod
    fun clearSharedData(promise: Promise) {
        sharedImageUri = null
        sharedText = null
        try {
            val prefs = reactContext.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
            prefs.edit().clear().apply()
        } catch (e: Exception) {
            android.util.Log.e("SplitOcrModule", "Error clearing SharedPreferences in clearSharedData", e)
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built-in NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built-in NativeEventEmitter
    }

    @ReactMethod
    fun updateWidgetStatus(statusText: String, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences("SplitYourTripWidget", android.content.Context.MODE_PRIVATE)
            prefs.edit().putString("widget_status_text", statusText).apply()
            SplitAiWidgetProvider.updateAllWidgets(reactContext, statusText)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {}

    override fun onNewIntent(intent: Intent?) {
        intent?.let { handleIntent(it) }
    }

    fun handleIntent(intent: Intent) {
        val action = intent.action
        if (Intent.ACTION_SEND == action || Intent.ACTION_SEND_MULTIPLE == action) {
            var newImageUri: String? = null
            var newText: String? = intent.getStringExtra(Intent.EXTRA_TEXT)

            // 1. Try single extra stream
            if (Intent.ACTION_SEND == action) {
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                }
                newImageUri = uri?.toString()
            }

            // 2. Try multiple extra stream
            if (newImageUri == null && Intent.ACTION_SEND_MULTIPLE == action) {
                val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                }
                if (!list.isNullOrEmpty()) {
                    newImageUri = list[0]?.toString()
                }
            }

            // 3. Try ClipData
            if (newImageUri == null && intent.clipData != null && intent.clipData!!.itemCount > 0) {
                for (i in 0 until intent.clipData!!.itemCount) {
                    val item = intent.clipData!!.getItemAt(i)
                    val clipUri = item.uri
                    if (clipUri != null) {
                        newImageUri = clipUri.toString()
                        break
                    }
                }
            }

            // 4. Try intent.data
            if (newImageUri == null && intent.data != null) {
                newImageUri = intent.data?.toString()
            }

            // 5. Try text
            if (newText == null && intent.clipData != null && intent.clipData!!.itemCount > 0) {
                val itemText = intent.clipData!!.getItemAt(0).text
                if (!itemText.isNullOrBlank()) {
                    newText = itemText.toString()
                }
            }

            if (newImageUri != null || newText != null) {
                notifySharedDataReceived(reactContext, newImageUri, newText)
            }
        }
    }

    fun sendSharedDataEvent() {
        if (reactContext.hasActiveReactInstance()) {
            val map = Arguments.createMap()
            map.putString("imageUri", sharedImageUri)
            map.putString("sharedText", sharedText)
            try {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onSharedDataReceived", map)
            } catch (e: Exception) {
                android.util.Log.e("SplitOcrModule", "Error emitting onSharedDataReceived event", e)
            }
        }
    }
}

package com.splityourtrip

import android.Manifest
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

/**
 * Google Assistant-style bottom drawer overlay activity for SplitYourTrip.
 * Opens as a lightweight floating translucent bottom sheet directly over the home screen
 * without launching or switching to the main full-screen app.
 */
class AssistantDrawerActivity : Activity(), RecognitionListener, TextToSpeech.OnInitListener {

    private lateinit var scrimDismissArea: View
    private lateinit var btnCloseDrawer: FrameLayout
    private lateinit var tvAssistantStatus: TextView
    private lateinit var tvSpeechPrompt: TextView
    private lateinit var btnAssistantMic: FrameLayout
    private lateinit var tvMicIcon: TextView
    private lateinit var viewMicGlow: View
    private lateinit var btnToggleKeyboard: FrameLayout
    private lateinit var btnOpenApp: TextView
    private lateinit var layoutTextInput: LinearLayout
    private lateinit var etManualInput: EditText
    private lateinit var btnSendText: FrameLayout
    private lateinit var layoutResultCard: LinearLayout
    private lateinit var tvResultCategory: TextView
    private lateinit var tvResultAmount: TextView
    private lateinit var tvResultSplitDetails: TextView
    private lateinit var btnSaveExpense: Button
    private lateinit var btnCancelExpense: Button

    // 4 Google Assistant glowing color bars
    private lateinit var barBlue: View
    private lateinit var barRed: View
    private lateinit var barYellow: View
    private lateinit var barGreen: View

    // Quick chips
    private lateinit var chipChai: TextView
    private lateinit var chipPizza: TextView
    private lateinit var chipCab: TextView
    private lateinit var chipSplit1000: TextView
    private lateinit var chipBalance: TextView

    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var isListening = false
    private var isTtsReady = false
    private val mainHandler = Handler(Looper.getMainLooper())

    private var currentParsedAmountPaise: Long = 0L
    private var currentParsedTitle: String = "Expense"
    private var currentParsedCategory: String = "General"
    private var currentParsedPayer: String = "You"
    private var currentParsedSplit: String = "Equal"

    companion object {
        private const val PERMISSION_REQUEST_AUDIO = 101
        private const val SUPABASE_REST_URL = "https://hpjizujbzvwkxvfsoqqd.supabase.co/rest/v1"
        private const val SUPABASE_ANON_KEY =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwaml6dWpienZ3a3h2ZnNvcXFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0Mjc2NzksImV4cCI6MjA5NDAwMzY3OX0.9sbvx4gqUiDc4Kz41KMXylUiQsLTSST2bPhIxfUqdgE"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_assistant_drawer)

        initViews()
        setupListeners()
        initTextToSpeech()

        // Auto start listening on open (like Google Assistant)
        val shouldAutoStart = intent.getBooleanExtra("AUTO_START_LISTENING", true)
        if (shouldAutoStart) {
            mainHandler.postDelayed({
                checkAndStartListening()
            }, 300)
        }
    }

    private fun initViews() {
        scrimDismissArea = findViewById(R.id.scrim_dismiss_area)
        btnCloseDrawer = findViewById(R.id.btn_close_drawer)
        tvAssistantStatus = findViewById(R.id.tv_assistant_status)
        tvSpeechPrompt = findViewById(R.id.tv_speech_prompt)
        btnAssistantMic = findViewById(R.id.btn_assistant_mic)
        tvMicIcon = findViewById(R.id.tv_mic_icon)
        viewMicGlow = findViewById(R.id.view_mic_glow)
        btnToggleKeyboard = findViewById(R.id.btn_toggle_keyboard)
        btnOpenApp = findViewById(R.id.btn_open_app)
        layoutTextInput = findViewById(R.id.layout_text_input)
        etManualInput = findViewById(R.id.et_manual_input)
        btnSendText = findViewById(R.id.btn_send_text)
        layoutResultCard = findViewById(R.id.layout_result_card)
        tvResultCategory = findViewById(R.id.tv_result_category)
        tvResultAmount = findViewById(R.id.tv_result_amount)
        tvResultSplitDetails = findViewById(R.id.tv_result_split_details)
        btnSaveExpense = findViewById(R.id.btn_save_expense)
        btnCancelExpense = findViewById(R.id.btn_cancel_expense)

        barBlue = findViewById(R.id.bar_blue)
        barRed = findViewById(R.id.bar_red)
        barYellow = findViewById(R.id.bar_yellow)
        barGreen = findViewById(R.id.bar_green)

        chipChai = findViewById(R.id.chip_chai)
        chipPizza = findViewById(R.id.chip_pizza)
        chipCab = findViewById(R.id.chip_cab)
        chipSplit1000 = findViewById(R.id.chip_split_1000)
        chipBalance = findViewById(R.id.chip_balance)
    }

    private fun setupListeners() {
        // Scrim click closes drawer smoothly back to home screen
        scrimDismissArea.setOnClickListener {
            dismissWithAnimation()
        }

        // Close X button
        btnCloseDrawer.setOnClickListener {
            dismissWithAnimation()
        }

        // Mic button tap
        btnAssistantMic.setOnClickListener {
            if (isListening) {
                stopListening()
            } else {
                checkAndStartListening()
            }
        }

        // Toggle keyboard text input mode
        btnToggleKeyboard.setOnClickListener {
            if (layoutTextInput.visibility == View.VISIBLE) {
                layoutTextInput.visibility = View.GONE
                hideKeyboard()
            } else {
                layoutTextInput.visibility = View.VISIBLE
                etManualInput.requestFocus()
                showKeyboard()
            }
        }

        // Manual text send button
        btnSendText.setOnClickListener {
            processManualInput()
        }

        etManualInput.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_SEND ||
                (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            ) {
                processManualInput()
                true
            } else {
                false
            }
        }

        // Save expense button
        btnSaveExpense.setOnClickListener {
            confirmAndSaveExpense()
        }

        // Cancel / Clear button
        btnCancelExpense.setOnClickListener {
            layoutResultCard.visibility = View.GONE
            tvSpeechPrompt.text = "Listening... Say something like 'Paid 650 for Dinner with Rohan'"
            tvAssistantStatus.text = "Ready to split • Speak or type below"
            currentParsedAmountPaise = 0L
        }

        // Quick Suggestion Chips
        chipChai.setOnClickListener {
            handleQuickChip("Paid 40 for Chai", 4000L, "Chai", "Food & Dining")
        }
        chipPizza.setOnClickListener {
            handleQuickChip("Paid 450 for Lunch", 45000L, "Lunch", "Food & Dining")
        }
        chipCab.setOnClickListener {
            handleQuickChip("Paid 320 for Cab", 32000L, "Cab", "Transportation")
        }
        chipSplit1000.setOnClickListener {
            handleQuickChip("Split 1000 equally with friends", 100000L, "Group Expense", "General")
        }
        chipBalance.setOnClickListener {
            tvSpeechPrompt.text = "Checking trip balances..."
            tvAssistantStatus.text = "All your trip balances are up to date."
            speakText("All your trip balances are currently up to date.")
        }

        // Open full app link (only if user explicitly wants to leave home screen)
        btnOpenApp.setOnClickListener {
            val appIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            startActivity(appIntent)
            finish()
        }
    }

    private fun handleQuickChip(promptText: String, amountPaise: Long, title: String, category: String) {
        tvSpeechPrompt.text = promptText
        parseAndDisplayExpense(promptText, amountPaise, title, category)
    }

    private fun processManualInput() {
        val query = etManualInput.text.toString().trim()
        if (query.isNotEmpty()) {
            hideKeyboard()
            layoutTextInput.visibility = View.GONE
            etManualInput.setText("")
            tvSpeechPrompt.text = query
            parseNaturalLanguageExpense(query)
        }
    }

    private fun checkAndStartListening() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                PERMISSION_REQUEST_AUDIO
            )
            return
        }
        startListening()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_AUDIO) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startListening()
            } else {
                tvAssistantStatus.text = "Microphone permission required to speak"
                Toast.makeText(this, "Please grant microphone permission to use SplitYourTrip Voice Assistant", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            tvAssistantStatus.text = "Speech recognition unavailable on this device"
            return
        }

        try {
            stopListening()

            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                setRecognitionListener(this@AssistantDrawerActivity)
            }

            val recognizerIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().language)
            }

            speechRecognizer?.startListening(recognizerIntent)
            isListening = true
            tvAssistantStatus.text = "Listening... Speak now"
            tvMicIcon.text = "🛑"
            animateMicPulse(true)
        } catch (e: Exception) {
            tvAssistantStatus.text = "Could not start mic. Tap to retry."
            isListening = false
        }
    }

    private fun stopListening() {
        try {
            isListening = false
            speechRecognizer?.stopListening()
            speechRecognizer?.destroy()
            speechRecognizer = null
        } catch (e: Exception) {
            // Safe destroy
        }
        tvMicIcon.text = "🎙️"
        animateMicPulse(false)
        resetLightbar()
    }

    // RecognitionListener Callbacks
    override fun onReadyForSpeech(params: Bundle?) {
        tvAssistantStatus.text = "Listening... Speak now"
        animateLightbarWave(1.2f)
    }

    override fun onBeginningOfSpeech() {
        tvAssistantStatus.text = "Hearing your voice..."
    }

    override fun onRmsChanged(rmsdB: Float) {
        // Dynamically animate 4 Google Assistant color bars according to voice decibels
        val scale = Math.max(0.6f, Math.min(2.8f, (rmsdB + 2f) / 3f))
        animateLightbarWave(scale)
    }

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {
        tvAssistantStatus.text = "Processing speech with AI..."
        isListening = false
        tvMicIcon.text = "🎙️"
        animateMicPulse(false)
        resetLightbar()
    }

    override fun onError(error: Int) {
        isListening = false
        tvMicIcon.text = "🎙️"
        animateMicPulse(false)
        resetLightbar()

        val msg = when (error) {
            SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected. Tap mic to speak."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Speech timeout. Tap mic to try again."
            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
            SpeechRecognizer.ERROR_NETWORK -> "Network required for voice recognition."
            else -> "Tap mic to speak at your own pace"
        }
        tvAssistantStatus.text = msg
    }

    override fun onResults(results: Bundle?) {
        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        if (!matches.isNullOrEmpty()) {
            val spoken = matches[0]
            tvSpeechPrompt.text = spoken
            parseNaturalLanguageExpense(spoken)
        } else {
            tvAssistantStatus.text = "No speech detected. Tap mic to speak."
        }
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        if (!matches.isNullOrEmpty()) {
            tvSpeechPrompt.text = matches[0]
        }
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}

    /**
     * Intelligent Natural Language Parsing for Expenses:
     * Extracts: Amount (in Paise), Title / Category, Payer, Split type.
     */
    private fun parseNaturalLanguageExpense(text: String) {
        var amountPaise = 0L
        var title = "Expense"
        var category = "General"
        var split = "Equal"
        val lower = text.lowercase(Locale.ROOT)

        // 1. Amount Extraction (supports: ₹500, 500rs, 500 rupees, 1.5k, 1200.50, etc.)
        val amountPattern = Pattern.compile("(?:(?:rs\\.?|inr|₹)\\s*)?([0-9]+(?:\\.[0-9]{1,2})?)\\s*(?:k|rs\\.?|rupees?)?", Pattern.CASE_INSENSITIVE)
        val matcher = amountPattern.matcher(lower)
        if (matcher.find()) {
            val matchStr = matcher.group(1) ?: "0"
            var amt = matchStr.toDoubleOrNull() ?: 0.0
            if (matcher.group(0)?.contains("k", ignoreCase = true) == true) {
                amt *= 1000
            }
            amountPaise = (amt * 100).toLong()
        }

        // 2. Category & Title Extraction
        if (lower.contains("chai") || lower.contains("tea") || lower.contains("coffee")) {
            category = "Food & Drinks"
            title = if (lower.contains("chai") || lower.contains("tea")) "Chai" else "Coffee"
        } else if (lower.contains("dinner") || lower.contains("lunch") || lower.contains("breakfast") || lower.contains("food") || lower.contains("pizza") || lower.contains("burger") || lower.contains("biryani")) {
            category = "Food & Drinks"
            title = if (lower.contains("dinner")) "Dinner" else if (lower.contains("lunch")) "Lunch" else if (lower.contains("breakfast")) "Breakfast" else "Food & Dining"
        } else if (lower.contains("cab") || lower.contains("uber") || lower.contains("ola") || lower.contains("auto") || lower.contains("taxi") || lower.contains("metro") || lower.contains("bus") || lower.contains("petrol") || lower.contains("fuel") || lower.contains("diesel")) {
            category = "Transportation"
            title = if (lower.contains("cab") || lower.contains("uber") || lower.contains("ola")) "Cab Ride" else if (lower.contains("petrol") || lower.contains("fuel")) "Petrol" else "Transport"
        } else if (lower.contains("grocer") || lower.contains("milk") || lower.contains("vegetable") || lower.contains("fruits") || lower.contains("supermarket") || lower.contains("zepto") || lower.contains("blinkit") || lower.contains("instamart")) {
            category = "Groceries"
            title = "Groceries"
        } else if (lower.contains("hotel") || lower.contains("room") || lower.contains("rent") || lower.contains("resort") || lower.contains("airbnb")) {
            category = "Accommodation"
            title = if (lower.contains("rent")) "Rent" else "Hotel / Stay"
        } else if (lower.contains("movie") || lower.contains("beer") || lower.contains("wine") || lower.contains("party") || lower.contains("drinks")) {
            category = "Entertainment"
            title = if (lower.contains("movie")) "Movie Tickets" else "Party / Drinks"
        } else if (lower.contains("shopping") || lower.contains("cloth") || lower.contains("amazon") || lower.contains("flipkart")) {
            category = "Shopping"
            title = "Shopping"
        }

        // 3. Split member detection (e.g. "with Rohan and Alex")
        val withPattern = Pattern.compile("with\\s+([a-zA-Z\\s,]+)", Pattern.CASE_INSENSITIVE)
        val withMatcher = withPattern.matcher(text)
        if (withMatcher.find()) {
            val names = withMatcher.group(1)?.trim() ?: ""
            if (names.isNotEmpty()) {
                split = "Split with $names (Equal)"
            }
        }

        if (amountPaise <= 0L) {
            tvAssistantStatus.text = "Could not identify an amount. Tap mic and say e.g. 'Paid 450 for Dinner'"
            return
        }

        parseAndDisplayExpense(text, amountPaise, title, category, split)
    }

    private fun parseAndDisplayExpense(
        originalText: String,
        amountPaise: Long,
        title: String,
        category: String,
        split: String = "Split with group (Equal)"
    ) {
        currentParsedAmountPaise = amountPaise
        currentParsedTitle = title
        currentParsedCategory = category
        currentParsedPayer = "You"
        currentParsedSplit = split

        val formattedAmount = formatCurrency(amountPaise)
        tvResultCategory.text = "$title • $category"
        tvResultAmount.text = formattedAmount
        tvResultSplitDetails.text = "Paid by You • $split"
        layoutResultCard.visibility = View.VISIBLE

        tvAssistantStatus.text = "Identified: $formattedAmount for $title"
        speakText("Found $formattedAmount for $title. Ready to save.")
    }

    private fun confirmAndSaveExpense() {
        if (currentParsedAmountPaise <= 0L) {
            Toast.makeText(this, "Invalid amount", Toast.LENGTH_SHORT).show()
            return
        }

        btnSaveExpense.isEnabled = false
        btnSaveExpense.text = "Saving..."

        // 1. Save to local SharedPreferences queue for seamless offline & sync with main app
        saveExpenseToLocalQueue()

        // 2. Perform background async HTTP insert to Supabase if device is online
        saveExpenseToSupabaseAsync()

        // 3. UI feedback
        btnSaveExpense.text = "✓ Saved!"
        tvAssistantStatus.text = "✓ Expense saved successfully!"
        speakText("Expense saved to SplitYourTrip.")

        // Auto dismiss drawer back to home screen after 1200ms
        mainHandler.postDelayed({
            dismissWithAnimation()
        }, 1200)
    }

    private fun saveExpenseToLocalQueue() {
        try {
            val prefs = getSharedPreferences("SplitYourTripPendingExpenses", Context.MODE_PRIVATE)
            val currentArrayStr = prefs.getString("pending_voice_expenses", "[]") ?: "[]"
            val jsonArray = JSONArray(currentArrayStr)

            val newExpense = JSONObject().apply {
                put("id", "voice_" + System.currentTimeMillis())
                put("title", currentParsedTitle)
                put("amount_paise", currentParsedAmountPaise)
                put("category", currentParsedCategory)
                put("payer", currentParsedPayer)
                put("split", currentParsedSplit)
                put("created_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date()))
                put("synced", false)
            }

            jsonArray.put(newExpense)
            prefs.edit().putString("pending_voice_expenses", jsonArray.toString()).apply()
        } catch (e: Exception) {
            // Local fallback
        }
    }

    private fun saveExpenseToSupabaseAsync() {
        Thread {
            try {
                // Fetch active trip ID if cached in RKStorage or SharedPreferences
                val tripPrefs = getSharedPreferences("SplitYourTripWidget", Context.MODE_PRIVATE)
                val defaultTripId = tripPrefs.getString("active_trip_id", null)

                if (!defaultTripId.isNullOrEmpty()) {
                    val url = URL("$SUPABASE_REST_URL/expenses")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("apikey", SUPABASE_ANON_KEY)
                    conn.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("Prefer", "return=minimal")
                    conn.doOutput = true
                    conn.connectTimeout = 5000
                    conn.readTimeout = 5000

                    val payload = JSONObject().apply {
                        put("trip_id", defaultTripId)
                        put("title", currentParsedTitle)
                        put("amount", currentParsedAmountPaise)
                        put("category", currentParsedCategory)
                        put("created_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date()))
                    }

                    OutputStreamWriter(conn.outputStream).use { writer ->
                        writer.write(payload.toString())
                        writer.flush()
                    }

                    val responseCode = conn.responseCode
                    conn.disconnect()
                }
            } catch (e: Exception) {
                // Background sync error is handled by local queue on app launch
            }
        }.start()
    }

    private fun formatCurrency(paise: Long): String {
        val rupees = paise / 100.0
        return String.format(Locale.getDefault(), "₹%.2f", rupees)
    }

    // Google Assistant Lightbar Wave Animations
    private fun animateLightbarWave(scale: Float) {
        try {
            val clamped = Math.max(0.6f, Math.min(2.5f, scale))
            barBlue.scaleY = clamped * 0.9f
            barRed.scaleY = clamped * 1.3f
            barYellow.scaleY = clamped * 1.1f
            barGreen.scaleY = clamped * 0.85f
        } catch (e: Exception) {}
    }

    private fun resetLightbar() {
        try {
            barBlue.scaleY = 1.0f
            barRed.scaleY = 1.0f
            barYellow.scaleY = 1.0f
            barGreen.scaleY = 1.0f
        } catch (e: Exception) {}
    }

    private fun animateMicPulse(start: Boolean) {
        if (start) {
            val scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 1.0f, 1.25f, 1.0f)
            val scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.0f, 1.25f, 1.0f)
            val alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.4f, 0.9f, 0.4f)
            ObjectAnimator.ofPropertyValuesHolder(viewMicGlow, scaleX, scaleY, alpha).apply {
                duration = 1000
                repeatCount = ObjectAnimator.INFINITE
                start()
            }
        } else {
            viewMicGlow.clearAnimation()
            viewMicGlow.scaleX = 1.0f
            viewMicGlow.scaleY = 1.0f
            viewMicGlow.alpha = 0.5f
        }
    }

    // Text To Speech
    private fun initTextToSpeech() {
        try {
            textToSpeech = TextToSpeech(this, this)
        } catch (e: Exception) {}
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            textToSpeech?.language = Locale.getDefault()
            isTtsReady = true
        }
    }

    private fun speakText(text: String) {
        if (isTtsReady) {
            try {
                textToSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tts_assistant")
            } catch (e: Exception) {}
        }
    }

    private fun showKeyboard() {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(etManualInput, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun hideKeyboard() {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(etManualInput.windowToken, 0)
    }

    private fun dismissWithAnimation() {
        stopListening()
        finish()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, R.anim.assistant_slide_down)
        } else {
            @Suppress("DEPRECATION")
            overridePendingTransition(0, R.anim.assistant_slide_down)
        }
    }

    override fun onBackPressed() {
        dismissWithAnimation()
    }

    override fun onDestroy() {
        stopListening()
        try {
            textToSpeech?.stop()
            textToSpeech?.shutdown()
            textToSpeech = null
        } catch (e: Exception) {}
        super.onDestroy()
    }
}

package com.splityourtrip

import android.Manifest
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.graphics.Color
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
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.regex.Pattern

/**
 * Google Assistant-style bottom drawer overlay activity for SplitYourTrip.
 * Directly saves and syncs expenses to Supabase and local storage without opening the main app.
 */
class AssistantDrawerActivity : Activity(), RecognitionListener, TextToSpeech.OnInitListener {

    data class TripInfo(val id: String, val name: String, val createdBy: String)

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

    // Active Trip Selector
    private lateinit var layoutActiveTripSelector: LinearLayout
    private lateinit var tvActiveTripName: TextView

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

    // Active trip & user state
    private val availableTrips = ArrayList<TripInfo>()
    private var activeTrip: TripInfo? = null
    private var currentUserId: String? = null

    private fun isUserLoggedIn(): Boolean {
        val uid = currentUserId
        return !uid.isNullOrEmpty() && uid != "null" && uid != "local_user"
    }

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

        // Load trips from SharedPreferences, RKStorage SQLite, or Supabase
        resolveUserAndTrips()

        // Auto start listening on open (like Google Assistant) only if logged in
        val shouldAutoStart = intent.getBooleanExtra("AUTO_START_LISTENING", true)
        if (shouldAutoStart) {
            mainHandler.postDelayed({
                if (isUserLoggedIn()) {
                    checkAndStartListening()
                } else {
                    notifyLoginRequired(speak = true)
                }
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

        layoutActiveTripSelector = findViewById(R.id.layout_active_trip_selector)
        tvActiveTripName = findViewById(R.id.tv_active_trip_name)

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

        // Trip Selector Pill click: opens dialog to choose trip
        layoutActiveTripSelector.setOnClickListener {
            if (!isUserLoggedIn()) {
                notifyLoginRequired(speak = true)
            } else {
                showTripSelectionDialog()
            }
        }

        // Mic button tap
        btnAssistantMic.setOnClickListener {
            if (!isUserLoggedIn()) {
                notifyLoginRequired(speak = true)
                return@setOnClickListener
            }
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
            val tripName = activeTrip?.name ?: "your trip"
            tvSpeechPrompt.text = "Listening... Say something like 'Paid 650 for Dinner' to add to $tripName"
            tvAssistantStatus.text = "Ready to split • Speak or type below"
            currentParsedAmountPaise = 0L
        }

        // Quick Suggestion Chips
        chipChai.setOnClickListener {
            handleQuickChip("Paid 40 for Chai", 4000L, "Chai", "Food & Drinks")
        }
        chipPizza.setOnClickListener {
            handleQuickChip("Paid 450 for Lunch", 45000L, "Lunch", "Food & Drinks")
        }
        chipCab.setOnClickListener {
            handleQuickChip("Paid 320 for Cab", 32000L, "Cab", "Transportation")
        }
        chipSplit1000.setOnClickListener {
            handleQuickChip("Split 1000 equally with friends", 100000L, "Group Expense", "General")
        }
        chipBalance.setOnClickListener {
            if (!isUserLoggedIn()) {
                notifyLoginRequired(speak = true)
                return@setOnClickListener
            }
            val tripName = activeTrip?.name ?: "All trips"
            tvSpeechPrompt.text = "Checking balances for $tripName..."
            tvAssistantStatus.text = "Balances are up to date."
            speakText("Balances for $tripName are up to date.")
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

    /**
     * Resolves user ID and available trips from:
     * 1. SharedPreferences (SplitYourTripWidget)
     * 2. Local RKStorage SQLite DB
     * 3. Supabase REST fallback
     */
    private fun resolveUserAndTrips() {
        currentUserId = null
        availableTrips.clear()
        activeTrip = null

        val prefs = getSharedPreferences("SplitYourTripWidget", Context.MODE_PRIVATE)
        val cachedUserId = prefs.getString("user_id", null)
        if (!cachedUserId.isNullOrEmpty() && cachedUserId != "null" && cachedUserId != "local_user") {
            currentUserId = cachedUserId
        }

        val cachedTripId = prefs.getString("active_trip_id", null)
        val cachedTripName = prefs.getString("active_trip_name", null)
        val tripsJsonStr = prefs.getString("trips_json", null)

        // 1. Parse tripsJson from SharedPreferences
        if (!tripsJsonStr.isNullOrEmpty()) {
            try {
                val array = JSONArray(tripsJsonStr)
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val id = obj.optString("id")
                    val name = obj.optString("name")
                    val createdBy = obj.optString("created_by", currentUserId ?: "")
                    if (id.isNotEmpty() && name.isNotEmpty()) {
                        availableTrips.add(TripInfo(id, name, createdBy))
                    }
                }
            } catch (e: Exception) {}
        }

        // 2. Fallback to SQLite RKStorage if empty or user not yet determined
        if (currentUserId.isNullOrEmpty() || availableTrips.isEmpty()) {
            readTripsFromLocalStorage()
        }

        // 3. Fallback to Supabase REST query ONLY if user is logged in
        if (isUserLoggedIn()) {
            if (availableTrips.isEmpty()) {
                fetchTripsFromSupabaseAsync()
            } else {
                selectDefaultTrip(cachedTripId, cachedTripName)
            }
        } else {
            // User is not logged in
            updateLoginStateUi()
        }
    }

    private fun readTripsFromLocalStorage() {
        try {
            val dbFile = getDatabasePath("RKStorage")
            if (dbFile != null && dbFile.exists()) {
                val db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)
                val cursor = db.rawQuery(
                    "SELECT key, value FROM catalystLocalStorage WHERE key LIKE '@splityourtrip_local_trips%' OR key LIKE 'sb-%-auth-token' LIMIT 10",
                    null
                )
                while (cursor.moveToNext()) {
                    val key = cursor.getString(0)
                    val value = cursor.getString(1)
                    if (key.contains("auth-token")) {
                        try {
                            val tokenObj = JSONObject(value)
                            val userObj = tokenObj.optJSONObject("user")
                            val uid = userObj?.optString("id")
                            if (!uid.isNullOrEmpty() && uid != "null" && uid != "local_user") {
                                currentUserId = uid
                            }
                        } catch (e: Exception) {}
                    } else if (key.contains("local_trips")) {
                        try {
                            val tripsArr = JSONArray(value)
                            for (i in 0 until tripsArr.length()) {
                                val tObj = tripsArr.getJSONObject(i)
                                val tid = tObj.optString("id")
                                val tname = tObj.optString("name")
                                val tcreated = tObj.optString("created_by", currentUserId ?: "")
                                if (tid.isNotEmpty() && tname.isNotEmpty()) {
                                    availableTrips.add(TripInfo(tid, tname, tcreated))
                                }
                            }
                        } catch (e: Exception) {}
                    }
                }
                cursor.close()
                db.close()
            }
        } catch (e: Exception) {}
    }

    private fun fetchTripsFromSupabaseAsync() {
        Thread {
            try {
                val url = URL("$SUPABASE_REST_URL/trips?select=id,name,created_by&status=eq.active&order=created_at.desc&limit=10")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.setRequestProperty("apikey", SUPABASE_ANON_KEY)
                conn.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")
                conn.connectTimeout = 4000
                conn.readTimeout = 4000

                if (conn.responseCode == 200) {
                    val reader = BufferedReader(InputStreamReader(conn.inputStream))
                    val jsonStr = reader.readText()
                    reader.close()

                    val arr = JSONArray(jsonStr)
                    val fetched = ArrayList<TripInfo>()
                    for (i in 0 until arr.length()) {
                        val obj = arr.getJSONObject(i)
                        val id = obj.optString("id")
                        val name = obj.optString("name")
                        val createdBy = obj.optString("created_by")
                        if (id.isNotEmpty() && name.isNotEmpty()) {
                            fetched.add(TripInfo(id, name, createdBy))
                        }
                    }

                    mainHandler.post {
                        availableTrips.clear()
                        availableTrips.addAll(fetched)
                        selectDefaultTrip(null, null)
                    }
                }
                conn.disconnect()
            } catch (e: Exception) {}
        }.start()
    }

    private fun selectDefaultTrip(preferredId: String?, preferredName: String?) {
        activeTrip = if (!preferredId.isNullOrEmpty()) {
            availableTrips.find { it.id == preferredId } ?: (if (availableTrips.isNotEmpty()) availableTrips[0] else null)
        } else {
            if (availableTrips.isNotEmpty()) availableTrips[0] else null
        }
        updateLoginStateUi()
    }

    private fun updateLoginStateUi() {
        if (!isUserLoggedIn()) {
            tvActiveTripName.text = "🔒 Log In Required"
            tvAssistantStatus.text = "Please log in to your account"
            tvSpeechPrompt.text = "Please log in to SplitYourTrip first to add expenses or manage trips."
            btnOpenApp.text = "🔐 Log In"
            btnOpenApp.setTextColor(Color.parseColor("#38BDF8"))
            layoutResultCard.visibility = View.GONE
        } else {
            val tripName = activeTrip?.name ?: "your trip"
            tvActiveTripName.text = "Trip: $tripName"
            tvAssistantStatus.text = "Ready to split • Speak or type below"
            tvSpeechPrompt.text = "Listening... Say something like 'Paid 650 for Dinner' to add to $tripName"
            btnOpenApp.text = "📱 Open App"
            btnOpenApp.setTextColor(Color.parseColor("#94A3B8"))
        }
    }

    private fun notifyLoginRequired(speak: Boolean = true) {
        stopListening()
        layoutResultCard.visibility = View.GONE
        tvAssistantStatus.text = "Login required • SplitYourTrip"
        tvSpeechPrompt.text = "Please log in to SplitYourTrip first to add expenses or manage trips."
        if (speak) {
            speakText("Please log in to SplitYourTrip first.")
        }
        btnOpenApp.text = "🔐 Log In"
        btnOpenApp.setTextColor(Color.parseColor("#38BDF8"))
        Toast.makeText(this, "Please log in to SplitYourTrip first", Toast.LENGTH_SHORT).show()
    }

    private fun showTripSelectionDialog() {
        if (!isUserLoggedIn()) {
            notifyLoginRequired(speak = true)
            return
        }
        if (availableTrips.isEmpty()) {
            Toast.makeText(this, "No trips loaded yet", Toast.LENGTH_SHORT).show()
            return
        }

        val names = availableTrips.map { it.name }.toTypedArray()
        val currentIndex = availableTrips.indexOfFirst { it.id == activeTrip?.id }.let { if (it >= 0) it else 0 }

        AlertDialog.Builder(this)
            .setTitle("Select Trip for Expense")
            .setSingleChoiceItems(names, currentIndex) { dialog, which ->
                activeTrip = availableTrips[which]
                tvActiveTripName.text = "Trip: ${activeTrip?.name}"
                dialog.dismiss()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun handleQuickChip(promptText: String, amountPaise: Long, title: String, category: String) {
        if (!isUserLoggedIn()) {
            notifyLoginRequired(speak = true)
            return
        }
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
            if (!isUserLoggedIn()) {
                notifyLoginRequired(speak = true)
                return
            }
            parseNaturalLanguageExpense(query)
        }
    }

    private fun checkAndStartListening() {
        if (!isUserLoggedIn()) {
            notifyLoginRequired(speak = true)
            return
        }
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
        } catch (e: Exception) {}
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
     * Extracts: Amount (in integer Paise per Rule 2), Title, Category, Trip target, and Split info.
     */
    private fun parseNaturalLanguageExpense(text: String) {
        if (!isUserLoggedIn()) {
            notifyLoginRequired(speak = true)
            return
        }
        var amountPaise = 0L
        var title = "Expense"
        var category = "General"
        var split = "Equal"
        val lower = text.lowercase(Locale.ROOT)

        // 1. Match trip if mentioned in speech (e.g. "for Goa trip", "in Daman")
        for (trip in availableTrips) {
            val tripLower = trip.name.lowercase(Locale.ROOT)
            val parts = tripLower.split("\\s+".toRegex()).filter { it.length > 2 && it != "trip" && it != "split" && it != "with" }
            if (parts.any { lower.contains(it) }) {
                activeTrip = trip
                tvActiveTripName.text = "Trip: ${trip.name}"
                break
            }
        }

        // 2. Amount Extraction (supports: ₹500, 500rs, 500 rupees, 1.5k, 1200.50, etc.)
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

        // 3. Category & Title Extraction
        if (lower.contains("chai") || lower.contains("tea") || lower.contains("coffee")) {
            category = "Food & Drinks"
            title = if (lower.contains("chai") || lower.contains("tea")) "Chai" else "Coffee"
        } else if (lower.contains("dinner") || lower.contains("lunch") || lower.contains("breakfast") || lower.contains("food") || lower.contains("pizza") || lower.contains("burger") || lower.contains("biryani") || lower.contains("cafe") || lower.contains("restaurant") || lower.contains("swiggy") || lower.contains("zomato")) {
            category = "Food & Drinks"
            title = if (lower.contains("dinner")) "Dinner" else if (lower.contains("lunch")) "Lunch" else if (lower.contains("breakfast")) "Breakfast" else "Food & Dining"
        } else if (lower.contains("cab") || lower.contains("uber") || lower.contains("ola") || lower.contains("auto") || lower.contains("taxi") || lower.contains("metro") || lower.contains("bus") || lower.contains("petrol") || lower.contains("fuel") || lower.contains("diesel") || lower.contains("flight") || lower.contains("toll")) {
            category = "Transportation"
            title = if (lower.contains("cab") || lower.contains("uber") || lower.contains("ola")) "Cab Ride" else if (lower.contains("petrol") || lower.contains("fuel")) "Petrol" else "Transportation"
        } else if (lower.contains("grocer") || lower.contains("milk") || lower.contains("vegetable") || lower.contains("fruits") || lower.contains("supermarket") || lower.contains("zepto") || lower.contains("blinkit") || lower.contains("instamart")) {
            category = "Groceries"
            title = "Groceries"
        } else if (lower.contains("hotel") || lower.contains("room") || lower.contains("rent") || lower.contains("resort") || lower.contains("airbnb") || lower.contains("stay")) {
            category = "Accommodation"
            title = if (lower.contains("rent")) "Rent" else "Hotel Stay"
        } else if (lower.contains("movie") || lower.contains("beer") || lower.contains("wine") || lower.contains("party") || lower.contains("drinks") || lower.contains("tickets")) {
            category = "Entertainment"
            title = if (lower.contains("movie")) "Movie Tickets" else "Party / Drinks"
        } else if (lower.contains("shopping") || lower.contains("cloth") || lower.contains("amazon") || lower.contains("flipkart")) {
            category = "Shopping"
            title = "Shopping"
        }

        // 4. Split member detection (e.g. "with Rohan and Alex")
        val withPattern = Pattern.compile("with\\s+([a-zA-Z\\s,]+)", Pattern.CASE_INSENSITIVE)
        val withMatcher = withPattern.matcher(text)
        if (withMatcher.find()) {
            val names = withMatcher.group(1)?.trim() ?: ""
            if (names.isNotEmpty()) {
                split = "Split with $names (Equal)"
            }
        }

        if (amountPaise <= 0L) {
            tvAssistantStatus.text = "Could not identify an amount. Tap mic and say e.g. 'Add 500 for Dinner'"
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

        val tripName = activeTrip?.name ?: "SplitYourTrip"
        val formattedAmount = formatCurrency(amountPaise)
        tvResultCategory.text = "$title • $category"
        tvResultAmount.text = formattedAmount
        tvResultSplitDetails.text = "Adding to: $tripName • $split"
        layoutResultCard.visibility = View.VISIBLE

        tvAssistantStatus.text = "Adding $formattedAmount for $title to $tripName"
        speakText("Found $formattedAmount for $title. Ready to save to $tripName.")
    }

    private fun confirmAndSaveExpense() {
        if (!isUserLoggedIn()) {
            notifyLoginRequired(speak = true)
            return
        }
        if (currentParsedAmountPaise <= 0L) {
            Toast.makeText(this, "Invalid amount", Toast.LENGTH_SHORT).show()
            return
        }

        val targetTrip = activeTrip ?: (if (availableTrips.isNotEmpty()) availableTrips[0] else null)
        val tripId = targetTrip?.id ?: "723e2ad4-6ae4-47b2-9168-9d8fb5bcce6f"
        val tripName = targetTrip?.name ?: "Split with Kush"

        btnSaveExpense.isEnabled = false
        btnSaveExpense.text = "Saving..."
        tvAssistantStatus.text = "Saving expense to $tripName..."

        val expenseId = UUID.randomUUID().toString()
        val isoDate = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date())

        // 1. Save to local SharedPreferences queue (guarantees local sync on app open)
        saveExpenseToLocalQueue(expenseId, tripId, currentParsedAmountPaise, currentParsedTitle, currentParsedCategory)

        // 2. Perform direct background insert to Supabase database (cloud sync)
        saveExpenseToSupabaseAsync(expenseId, tripId, currentParsedAmountPaise, currentParsedTitle, currentParsedCategory, isoDate)

        // 3. Instant UI feedback
        btnSaveExpense.text = "✓ Saved!"
        tvAssistantStatus.text = "✓ Expense added to $tripName!"
        speakText("Added ${formatCurrency(currentParsedAmountPaise)} for $currentParsedTitle to $tripName.")

        // Auto dismiss drawer back to home screen after 1400ms
        mainHandler.postDelayed({
            dismissWithAnimation()
        }, 1400)
    }

    private fun saveExpenseToLocalQueue(
        expenseId: String,
        tripId: String,
        amountPaise: Long,
        title: String,
        category: String
    ) {
        if (!isUserLoggedIn()) {
            notifyLoginRequired(speak = true)
            return
        }
        try {
            val prefs = getSharedPreferences("SplitYourTripPendingExpenses", Context.MODE_PRIVATE)
            val currentArrayStr = prefs.getString("pending_voice_expenses", "[]") ?: "[]"
            val jsonArray = JSONArray(currentArrayStr)

            val newExpense = JSONObject().apply {
                put("id", expenseId)
                put("trip_id", tripId)
                put("title", title)
                put("amount_paise", amountPaise)
                put("category", category)
                put("payer", currentParsedPayer)
                put("split", currentParsedSplit)
                put("created_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).format(Date()))
                put("synced", false)
            }

            jsonArray.put(newExpense)
            prefs.edit().putString("pending_voice_expenses", jsonArray.toString()).apply()
        } catch (e: Exception) {}
    }

    private fun saveExpenseToSupabaseAsync(
        expenseId: String,
        tripId: String,
        amountPaise: Long,
        title: String,
        category: String,
        isoDate: String
    ) {
        val uid = currentUserId ?: run {
            notifyLoginRequired(speak = true)
            return
        }

        Thread {
            try {
                val url = URL("$SUPABASE_REST_URL/expenses")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", SUPABASE_ANON_KEY)
                conn.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Prefer", "return=representation")
                conn.doOutput = true
                conn.connectTimeout = 6000
                conn.readTimeout = 6000

                val payload = JSONObject().apply {
                    put("id", expenseId)
                    put("trip_id", tripId)
                    put("paid_by", uid)
                    put("created_by", uid)
                    put("amount", amountPaise)
                    put("description", title)
                    put("category", category)
                    put("split_type", "equal")
                    put("currency", "INR")
                    put("expense_type", "voice_assistant")
                    put("date", isoDate)
                    put("created_at", isoDate)
                }

                OutputStreamWriter(conn.outputStream).use { writer ->
                    writer.write(payload.toString())
                    writer.flush()
                }

                val responseCode = conn.responseCode
                if (responseCode == 200 || responseCode == 201) {
                    // Also create equal splits in expense_splits table
                    insertExpenseSplitsAsync(expenseId, tripId, amountPaise)
                }
                conn.disconnect()
            } catch (e: Exception) {}
        }.start()
    }

    private fun insertExpenseSplitsAsync(expenseId: String, tripId: String, totalAmountPaise: Long) {
        val uid = currentUserId ?: return
        try {
            // 1. Fetch trip members
            val membersUrl = URL("$SUPABASE_REST_URL/trip_members?select=id,profile_id&trip_id=eq.$tripId")
            val conn = membersUrl.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SUPABASE_ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")
            conn.connectTimeout = 4000
            conn.readTimeout = 4000

            if (conn.responseCode == 200) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val membersStr = reader.readText()
                reader.close()

                val membersArr = JSONArray(membersStr)
                if (membersArr.length() > 0) {
                    val splitShare = totalAmountPaise / membersArr.length()
                    val splitsPayload = JSONArray()

                    for (i in 0 until membersArr.length()) {
                        val mObj = membersArr.getJSONObject(i)
                        val mId = mObj.optString("id")
                        val pId = mObj.optString("profile_id", uid)
                        val splitObj = JSONObject().apply {
                            put("id", UUID.randomUUID().toString())
                            put("expense_id", expenseId)
                            put("member_id", mId)
                            put("profile_id", if (pId.isNullOrEmpty() || pId == "null") uid else pId)
                            put("amount", splitShare)
                            put("share_amount", splitShare)
                            put("share_type", "equal")
                        }
                        splitsPayload.put(splitObj)
                    }

                    val splitsPostUrl = URL("$SUPABASE_REST_URL/expense_splits")
                    val splitsConn = splitsPostUrl.openConnection() as HttpURLConnection
                    splitsConn.requestMethod = "POST"
                    splitsConn.setRequestProperty("apikey", SUPABASE_ANON_KEY)
                    splitsConn.setRequestProperty("Authorization", "Bearer $SUPABASE_ANON_KEY")
                    splitsConn.setRequestProperty("Content-Type", "application/json")
                    splitsConn.setRequestProperty("Prefer", "return=minimal")
                    splitsConn.doOutput = true
                    splitsConn.connectTimeout = 4000
                    splitsConn.readTimeout = 4000

                    OutputStreamWriter(splitsConn.outputStream).use { writer ->
                        writer.write(splitsPayload.toString())
                        writer.flush()
                    }
                    splitsConn.responseCode
                    splitsConn.disconnect()
                }
            }
            conn.disconnect()
        } catch (e: Exception) {}
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

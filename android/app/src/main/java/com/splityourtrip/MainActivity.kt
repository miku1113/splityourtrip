package com.splityourtrip

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

import android.content.Intent
import android.net.Uri

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    handleIncomingIntent(intent)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingIntent(intent)
  }

  private fun handleIncomingIntent(intent: Intent?) {
    if (intent == null) return
    val action = intent.action
    if (Intent.ACTION_SEND == action || Intent.ACTION_SEND_MULTIPLE == action) {
      val type = intent.type
      var uriStr: String? = null
      var textStr: String? = intent.getStringExtra(Intent.EXTRA_TEXT)

      // 1. Try single extra stream (Uri)
      if (Intent.ACTION_SEND == action) {
        val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        }
        uriStr = uri?.toString()
      }

      // 2. Try multiple extra stream (ArrayList<Uri>)
      if (uriStr == null && Intent.ACTION_SEND_MULTIPLE == action) {
        val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
        }
        if (!list.isNullOrEmpty()) {
          uriStr = list[0]?.toString()
        }
      }

      // 3. Try ClipData (frequently used by Google Photos, Google Pay, Samsung Gallery on Android 10-15)
      if (uriStr == null && intent.clipData != null && intent.clipData!!.itemCount > 0) {
        for (i in 0 until intent.clipData!!.itemCount) {
          val item = intent.clipData!!.getItemAt(i)
          val clipUri = item.uri
          if (clipUri != null) {
            uriStr = clipUri.toString()
            break
          }
        }
      }

      // 4. Try intent.data (direct URI)
      if (uriStr == null && intent.data != null) {
        uriStr = intent.data?.toString()
      }

      // 5. Try shared text
      if (textStr == null && intent.clipData != null && intent.clipData!!.itemCount > 0) {
        val itemText = intent.clipData!!.getItemAt(0).text
        if (!itemText.isNullOrBlank()) {
          textStr = itemText.toString()
        }
      }

      android.util.Log.d("MainActivity", "handleIncomingIntent: action=$action type=$type uri=$uriStr text=$textStr")

      if (uriStr != null || textStr != null) {
        SplitOcrModule.notifySharedDataReceived(this, uriStr, textStr)
      }
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}

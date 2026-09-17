package com.tinta.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var loadingView: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private var pageFinished = false
    private var fallbackOpened = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this)
        webView = WebView(this)
        webView.setBackgroundColor(Color.WHITE)
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))

        loadingView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
        }
        loadingView.addView(TextView(this).apply {
            text = "TINTA"
            textSize = 42f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })
        loadingView.addView(TextView(this).apply {
            text = "Loading..."
            textSize = 16f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 0)
        })
        root.addView(loadingView, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        webView.visibility = View.INVISIBLE
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.loadsImagesAutomatically = true
        webView.settings.javaScriptCanOpenWindowsAutomatically = true
        webView.settings.setSupportMultipleWindows(false)
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.userAgentString = webView.settings.userAgentString + " TINTA-Android"
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false

            override fun onPageFinished(view: WebView, url: String) {
                pageFinished = true
                loadingView.visibility = View.GONE
                webView.visibility = View.VISIBLE
                handler.postDelayed({
                    if (!fallbackOpened && webView.contentHeight <= 0) openInBrowser()
                }, 3500)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) openInBrowser()
            }
        }

        webView.loadUrl(BuildConfig.TINTA_WEB_URL)
        handler.postDelayed({
            if (!pageFinished && !fallbackOpened) openInBrowser()
        }, 8000)
    }

    private fun openInBrowser() {
        if (fallbackOpened) return
        fallbackOpened = true
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.TINTA_WEB_URL)))
        } catch (_: Exception) {
            loadingView.visibility = View.VISIBLE
        }
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack() && !fallbackOpened) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}

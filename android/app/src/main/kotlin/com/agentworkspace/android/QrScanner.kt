package com.agentworkspace.android

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * The QR scan of a pairing code (docs/tech-stack.md 1.5): the ML Kit code scanner of Google Play
 * services. It needs no camera permission: Play services shows the camera and gives only the text.
 * This is the one adapter of the scanner; with no Play services the pairing screen shows only the
 * paste field (`engineering-rules.md` 4.9.1).
 */
class QrScanner(
    private val context: Context,
) {
    /** True when Google Play services can run the scanner on this phone. */
    fun available(): Boolean =
        runCatching {
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
        }.getOrDefault(false)

    /** Opens the scanner. [onCode] gets the text of the QR code; a cancel calls nothing. */
    fun scan(
        onCode: (String) -> Unit,
        onError: (String) -> Unit,
    ) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning
            .getClient(context, options)
            .startScan()
            .addOnSuccessListener { barcode ->
                val text = barcode.rawValue
                if (text.isNullOrBlank()) onError("The QR code has no text") else onCode(text)
            }.addOnFailureListener { onError("The QR scanner did not start: paste the code") }
    }
}

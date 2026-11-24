package com.agentworkspace.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.agentworkspace.control.ArtifactList
import com.agentworkspace.control.ArtifactRow
import com.agentworkspace.control.ArtifactRule
import java.nio.file.Path

/**
 * "Open" of a downloaded artifact (openspec gate-full-context): `ACTION_VIEW` with a content URI of
 * the FileProvider and a read grant for this one file. Only an artifact path and a document type
 * (ArtifactRule.openable): a synced program never goes to another app. Null when an app opened it, else the text.
 */
class ArtifactOpener(
    private val context: Context,
) {
    fun open(
        root: Path,
        row: ArtifactRow,
    ): String? {
        if (!ArtifactList.isArtifactPath(
                row.task,
                row.path,
            )
        ) {
            return "AW does not open ${row.name}: it is not an artifact."
        }
        if (!ArtifactRule.openable(row.name)) return ArtifactRule.notOpenable(row.name)
        val file = root.resolve(row.file).toFile()
        if (!file.isFile) return "${row.name} is not on this phone yet."
        // getUriForFile refuses a file whose real path is outside the shared folder (for example a link).
        val uri =
            try {
                FileProvider.getUriForFile(context, "${context.packageName}.artifacts", file)
            } catch (_: IllegalArgumentException) {
                return "AW does not open ${row.name}: the file is outside the workspace folder."
            }
        val type =
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(row.name.substringAfterLast('.', "").lowercase())
                ?: "application/octet-stream"
        val intent =
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, type)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            null
        } catch (_: ActivityNotFoundException) {
            "No app on this phone opens ${row.name}."
        }
    }
}

/** The network check of Download (docs/phase-1.md 10.3): a metered network is mobile data. */
class NetworkCheck(
    private val context: Context,
) {
    fun metered(): Boolean = context.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered
}

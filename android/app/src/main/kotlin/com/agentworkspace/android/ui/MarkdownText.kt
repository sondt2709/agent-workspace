package com.agentworkspace.android.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import com.agentworkspace.control.LinkRule
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownTypography

/**
 * Claude output as Markdown (openspec polish-prototype-style), with the maintained renderer of
 * docs/tech-stack.md 2.5. The renderer draws Compose text: no HTML or script runs, and it loads no
 * image (no image transformer). A tap on a link opens the system browser only for `https://`.
 */
@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val links = remember(context) { BrowserLinks(context) }
    val type = MaterialTheme.typography
    val body = type.bodyMedium
    CompositionLocalProvider(LocalUriHandler provides links) {
        Markdown(
            content = text,
            modifier = modifier.fillMaxWidth(),
            // Headings stay small inside a card or a message, as on the desktop (docs/design.md 3).
            typography =
                markdownTypography(
                    h1 = type.titleMedium,
                    h2 = type.titleMedium,
                    h3 = type.titleSmall,
                    h4 = type.titleSmall,
                    h5 = type.titleSmall,
                    h6 = type.titleSmall,
                    text = body,
                    code = type.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    quote = body,
                    paragraph = body,
                    ordered = body,
                    bullet = body,
                    list = body,
                    textLink =
                        TextLinkStyles(
                            style =
                                body
                                    .copy(
                                        color = MaterialTheme.colorScheme.primary,
                                        textDecoration = TextDecoration.Underline,
                                    ).toSpanStyle(),
                        ),
                ),
        )
    }
}

/** Opens a link of [LinkRule] in the system browser; other links do nothing. */
private class BrowserLinks(
    private val context: Context,
) : UriHandler {
    override fun openUri(uri: String) {
        if (!LinkRule.opens(uri)) return
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // No browser on the device: the tap does nothing.
        }
    }
}
